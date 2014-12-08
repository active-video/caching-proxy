/**
 * @author Chad Wagner, cwagner@activevideo.com
 * @license MIT
 */
"use strict";

var FORCE_DOWNLOAD=false,

util = require('util'),
EventEmitter = require("events").EventEmitter,
File = require("fs"),
Path = require("path"),
crypto = require('crypto'),
http = require('follow-redirects').http,
https = require('follow-redirects').https,
url = require('url'),

mkdir = require('mkdirp').sync,

exists = File.exists || Path.exists,
existsSync = File.existsSync || Path.existsSync;


/**
 *
 * @param options {Object} url, headers, proxyPath, method[, dir, body]
 * @constructor
 */
function Cache(options) {
    this.init(options);
}

//util.inherits(Cache, EventEmitter);

// class methods
//util._extend(
Cache.prototype = {
    id: null,
    url: null,
    requestHeaders: null,
    requestBody: null,
    options: null,
    path : null,
    secure : false,
    exclude: null,

    proxyPath : null,

    responseSize: null,
    responseHeaders: null,
    responseBody: null,

    /**
     * Called when constructing a new Cache object
     * @constructor
     * @param options
     */
    init: function (options) {
        this.options = options || {};

        // always initialize all instance properties
        this.dir = this.options.dir || undefined;
        this._baseDir = Path.resolve(this.dir || "data/cache");
        this._id = undefined;
        this.proxyPath = this.options.proxyPath;
        this.exclude = this.options.exclude || [];

        this.method = this.options.method || "GET";
        this.url = this.options.url;
        this.requestHeaders = this.options.headers;
        this.requestBody = this.options.body;

        this.secure = this.url.indexOf('https') === 0;


        this._exists = this.exists();
    },

    /**
     * From a URL strip any basic auth of the form 'username:password'
     * @param str
     * @returns {string}
     */
    removeAuthFromString : function(str){
        return (str || "").replace(/([a-zA-Z0-9\%]+\:[a-zA-Z0-9\%]+\@)/, '');
    },

    /**
     * Get the ID of this cached object, a function of the Method + URL + Post Body (if any)
     * @returns {String} The id of the file, which includes the final part of the URL path and a sha1() of the input parameters
     */
    getId: function () {
        if(this._id !== undefined){
            return this._id;
        }

        //the URL should remove any basic auth from it, to be agnostic of HTTP auth if it is later removed from the server
        var requestUrl = this.method + " " + this.removeAuthFromString(this.url);

        for(var i=0; i<this.exclude.length; i++){
            var regex = new RegExp(this.exclude[i]+'\=[a-zA-Z0-9\\-\\_]+[\&]*','ig')
            requestUrl = requestUrl.replace(regex, '');

        }
        //remove any parameters without values, like ?123
        requestUrl = requestUrl.replace(/[\&\?][0-9]+[\&]*$/i, '');
        //replace trailing characters
        requestUrl = requestUrl.replace(/[\&\?]$/,'');

        var urlInfo = url.parse(requestUrl);
        var fileParts = urlInfo.pathname.split('/').pop().split('.');
        var fileName = fileParts[0];
        var fileExt = fileParts[1] || 'txt';

        //only care about URL and post body
        var sha1 = crypto.createHash('sha1');
        sha1.update(requestUrl);
        if (this.requestBody) {
            sha1.update(this.requestBody);
        }

        this._id = fileName + '-' + sha1.digest('hex') + '.' + fileExt;
        return this._id;
    },

    /**
     * Get the file path name for all files related to this Cache object
     * @returns {string}
     */
    getFilePath: function () {
        return this._baseDir + "/" + this.getId();
    },

    /**
     * Get the file path for the body portion of response
     * @returns {string}
     */
    getFilePathBody: function(){
        return this.getFilePath();//maybe add on a .raw or something
    },

    /**
     * Get the file path for where to store the headers + status, which are written to disk
     * in a single file separate from the body so that the sync read of it is not affected
     * by the size of the actual response, and encoding can be independent of the body encoding
     * @returns {string}
     */
    getFilePathHeaders: function(){
        return this.getFilePath() + ".json";
    },

    /**
     * Does this object exist in the cache
     * @returns {*}
     */
    exists: function () {
        if (this._exists !== undefined) {
            return this._exists;
        }else if(FORCE_DOWNLOAD){
            return false;
        }

        //this only creates it if it doesn't exist
        mkdir(this._baseDir);


        var path = this.getFilePathHeaders();
        return existsSync(path);
    },

    /**
     * Will serve a 304 header and end the http.ServerResponse (res) immediately.
     *
     * @param req The original client request
     * @param res The client response that we should serve a 304 to if the object is not newer
     * @param headers The headers from the request
     * @returns {boolean} Returns true if the object is not newer than the if-modified-since header, false otherwise
     */
    serveNoChangeHeaderIfNotModified: function(req, res, headers){
        //we can manually serve 304's
        var ifModifiedSince = req && req.headers && req.headers['if-modified-since'];

        if (ifModifiedSince) {
            if(!headers['last-modified']){
                return false;
            }

            var ifModified = (new Date(ifModifiedSince)).getTime();
            var lastModified = (new Date(headers['last-modified'])).getTime();

            //console.log('ifModifiedSince', ifModifiedSince, ifModified, lastModified, lastModified > ifModified);
            if(lastModified <= ifModified){
                console.log('(send304) Serving 304, ' + lastModified + '<=' + ifModified);
                res.writeHead(304, {
                    'caching-proxy-served-from' : 'Cache'
                });

                res.end();
                return true;
            }
        }

        return false;
    },

    /**
     * Load the status and headers from the meta data file, *.json
     * @returns {Object|undefined} An object with 2 properties, {status:String, headers:Object}
     */
    getHeadersFromFile : function(){
        var buffer = File.readFileSync(this.getFilePathHeaders());
        var metaDataString = buffer && buffer.toString('utf8');
        var metaData = metaDataString && JSON.parse(metaDataString);

        return metaData || undefined;
    },

    /**
     * For requests that are servable from cache, this function serves the headers and pipes the body to the response
     * for non text files, for text files it processes the text and replaces http/https URLs first before serving response
     * @param req
     * @param res
     */
    serve: function(req, res){
        var metaData = this.getHeadersFromFile(),
            headers = metaData && metaData.headers;

        headers['caching-proxy-served-from'] = "Cache";

        if(!metaData){
            this.sendHeaders(res, 500, {});
            res.end("Unable to parse response headers from disk");
            return;
        }else if(this.serveNoChangeHeaderIfNotModified(req, res, headers)){
            return;
        }

        this.sendCachedResponse(res, metaData.status, metaData.headers);
    },

    /**
     * Given the headers, it will either (a) if text/json/xml process and serve the response after
     * reading full data from disk, (b) otherwise open a read stream to the cached data file
     * and pipe it to the http.ServerResponse (res)
     * @param res
     * @param status
     * @param headers
     */
    sendCachedResponse: function(res, status, headers){

        var contentType = headers && headers['content-type'];

        //stream response if non-text
        if(!contentType || !contentType.match(/(text|json|xml)/i)){
            this.sendHeaders(res, status, headers);
            //get the content and stream it back
            File.createReadStream(this.getFilePathBody()).pipe(res);

        //else text, so need to replace content with proxy paths
        }else{
            var buffer = File.readFileSync(this.getFilePathBody());
            var body = buffer && buffer.toString('utf8');
            if(body){
                body = this.updateResponse(body);
            }
            this.responseBody = body;

            var length = Buffer.byteLength(body, 'utf8');

            headers['content-length'] = length;
            this.sendHeaders(res, status, headers);
            res.end(body);
        }
    },

    /**
     * Write the status and headers to disk as this.getFilePathHeaders()
     * @param status
     * @param headers
     */
    writeHeaders: function(status, headers){
        File.writeFileSync(this.getFilePathHeaders(), JSON.stringify({
                status: status,
                headers: headers
            },
            undefined,
            '  '
        ));
    },

    /**
     * Wires up the IncomingMessage body to the file this.getFilePathBody()
     * and starts piping the data from the message into the file
     * @param incomingMessage
     */
    writeBody: function(incomingMessage){
        console.log("FILEWRITE: " + this.getFilePathBody());
        var writeStream = File.createWriteStream(this.getFilePathBody());
        incomingMessage.pipe(writeStream);
    },

    /**
     * Given data, writes it to this.getFilePathBody() synchronously
     * @param data UTF8 string
     */
    writeBodySync: function(data){
        File.writeFileSync(this.getFilePathBody(), data);
    },

    /**
     * Adds to this.responseBody the data within chunk, generally called
     * as chunked pieces of the response are received
     * @param chunk
     */
    appendData: function(chunk){
        this.responseBody += chunk;
    },

    /**
     * Sends the status and headers{} to the http.ServerResponse res
     * @param res
     * @param status Status code, i.e. 200, 404, etc
     * @param headers Header object
     */
    sendHeaders: function(res, status, headers){
        res.writeHeader(status, headers);
    },

    /**
     * As soon as the IncomingMessage headers have been received, this method is called
     * and based on the content-type we either (a) for non-text pipe the IncomingMessage
     * response data directly to the disk and to the http.ServerResponse back to the request that
     * is being served
     *
     * @param res The http.ServerResponse being served
     * @param incomingMessage The http.IncomingMessage that we are receiving from the request we made on behalf of the client and caching
     */
    onData: function(res, incomingMessage){
        incomingMessage.pause();

        var success = incomingMessage.statusCode === 200;
        var headers = incomingMessage.headers;

        headers['caching-proxy-served-from'] = "Fresh/Internet";


        var contentType = headers && headers['content-type'];
        var contentLength = headers && headers['content-length'];

        if(contentType && contentType.match(/(text|json|xml)/i)){
            this.responseBody = '';
            incomingMessage.on('end', this.onEnd.bind(this, res, incomingMessage));
            incomingMessage.on('data', this.appendData.bind(this));
            incomingMessage.resume();
            return;
        }else if(this.secure){
            this.responseBody = '';
            incomingMessage.on('end', this.onEndSecure.bind(this, res, incomingMessage));
            incomingMessage.on('data', this.appendData.bind(this));
        }else{
            this.sendHeaders(res, incomingMessage.statusCode, headers);
            incomingMessage.pipe(res);

        }

        //pipe to the file system as well
        if(success){
            this.writeHeaders(incomingMessage.statusCode, headers);
            this.writeBody(incomingMessage);
        }

        incomingMessage.resume();
    },

    /**
     * Called when an error occurs with the proxied request, i.e. a bad SSL cert, etc
     *
     * @param res
     * @param incomingMessage
     * @param evt
     */
    onError: function(res, incomingMessage, evt){
        console.warn('ERROR WITH PROXY REQUEST ' + (evt.code || 'Unknown') + ', ' + evt.message +' (for url= '+this.url + ')');

        res.writeHead(evt.code || 500, incomingMessage.headers || {});
        res.end(evt.message || "Unknown Cache Proxy Error");
    },

    /**
     * Processes the completed request for text files, by replacing all http/https resources
     * in the body with the path to the current server/port + original http/https url
     * so that requests for any absolute path in the cached response are routed
     * back this way
     *
     * @param res
     * @param incomingMessage
     */
    onEnd: function(res, incomingMessage){

        var success = incomingMessage.statusCode === 200;

        //We only write headers/data upon 100% success in the case of a file that
        //is not being piped
        if(success) {
            this.writeHeaders(incomingMessage.statusCode, incomingMessage.headers);
            this.writeBodySync(this.responseBody);
        }

        var body = this.updateResponse(this.responseBody);
        var headers = incomingMessage.headers;
        var length = Buffer.byteLength(body, 'utf8');

        headers['content-length'] = length;
        headers['caching-proxy-served-from'] = "Fresh/Internet";

        this.sendHeaders(res, incomingMessage.statusCode, headers);


        res.end(body);
    },

    /**
     * The secure serving has race conditions present and is not stable/supported at this time
     * @param res
     * @param incomingMessage
     */
    onEndSecure: function(res, incomingMessage){
        this.writeBodySync(this.responseBody);

        this.sendHeaders(res, incomingMessage.statusCode, incomingMessage.headers);
        this.sendCachedBody(res);
    },

    /**
     * Will replace all http/https absolute URLs with a path back to this caching proxy
     * @param body
     * @returns {XML|string}
     */
    updateResponse: function (body) {
        var url = this.proxyPath;
        console.log("UPDATE RESPONSE: " + this.url);

        body = body.replace(/http\:\/\//g, url  + 'http/');
        body = body.replace(/https\:\/\//g, url  + 'https/');

        return body;
    },

    /**
     * Because a condition exists where the ClientRequest.abort() occurs (triggered by
     * the client exiting before we are done serving the response) this method exists
     * to at some point help us more gracefully handle that condition
     *
     * @param clientRequest The request we are servicing, which may be possible to introspect on and determine if it was closed cleanly or aborted
     * @param res the http.ServerResponse we are serving
     * @param incomingMessage the http.ClientRequest which is currently being made to the external URL
     * @param evt
     */
    onOriginalRequestClosed: function (clientRequest, res, request, evt) {
        var reason = evt;
        var args = arguments;


        return;
    },

    /**
     * The router for a request that services it and then subsequently makes the request to
     * the destination (http.ClientRequest) and caches it. Also writes the first chunk of the
     * POST body to the destination
     *
     * @param clientRequest
     * @param res
     * @param options
     */
    captureThenServe : function(clientRequest, res, options){
        var body = this.requestBody;

        //doesn't matter if the requestor has the object, if we don't,
        //we can't direct the server that we do since then we
        //can not use the object returned as it will be empty if 304
        if(options.headers){
            delete options.headers['if-modified-since'];
            delete options.headers['if-none-match'];
        }
        console.log("FILECAPTURE: " + options.fullUrl);

        var requestsLib = options.fullUrl.indexOf('https') === 0 ? https : http;

        var request = this.request = requestsLib.request(options, this.onData.bind(this, res));
        clientRequest.on('close', this.onOriginalRequestClosed.bind(this, clientRequest, res, request));

        //request.on('response', this.onHeaders.bind(this, res, request));
        request.on('error', this.onError.bind(this, res, request));

        //setTimeout(this.onData.bind(this, res), 6000);

        if(body){
            request.write(body);//@TODO this does not support chunked posts larger than 1 chunk
            console.log(options.method.toUpperCase() + " BODY FORWARDED");
        }

        request.end();

    }

}
//);
/**
 * export the Cache class
 */

module.exports = Cache;