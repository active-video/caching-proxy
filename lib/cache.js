/**
 * @author Chad Wagner, cwagner@activevideo.com
 * @license MIT
 */
"use strict";

var FORCE_DOWNLOAD=false,

util = require('util'),
EventEmitter = require('events').EventEmitter,
File = require('fs'),
Path = require('path'),
crypto = require('crypto'),
http = require('follow-redirects').http,
https = require('follow-redirects').https,
url = require('url'),
sanitize = require("sanitize-filename"),

mkdir = require('mkdirp').sync,

exists = File.exists || Path.exists,
existsSync = File.existsSync || Path.existsSync;


/**
 *
 * @param options {Object} url, headers, proxyPath, method[, dir, body]
 * @constructor
 */
function Cache(options, res) {
    this.init(options, res);
}

//util.inherits(Cache, EventEmitter);

// class methods
//util._extend(
Cache.prototype = {
    id: null,
    url: null,
    directoryCheck: false,
    aborted: false,
    requestHeaders: null,
    requestBody: null,
    options: null,
    path : null,
    secure : false,
    exclude: null,

    allowedErrors: [],

    proxyPath : null,
    writeStream: null,

    responseSize: null,
    responseHeaders: null,
    responseBody: null,
    responseStatus: null,

    res: null,

    /**
     * Called when constructing a new Cache object
     * @constructor
     * @param options
     */
    init: function (options, res) {
        this.options = options || {};
        this.res = res;
        this.allowedErrors = this.options.allowedErrors || [];
        for(var i=0; i<this.allowedErrors.length; i++){
            this.allowedErrors[i] = parseInt(this.allowedErrors[i], 10);
        }

        // always initialize all instance properties
        this.dir = this.options.dir || undefined;
        this._baseDir = Path.resolve(this.dir || 'data/cache');
        this._tmpDir = Path.resolve(this.dir || 'data/cache') + '/tmp';
        this._id = undefined;
        this.proxyPath = this.options.proxyPath;
        this.exclude = this.options.exclude || [];

        this.method = this.options.method || 'GET';
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
        return (str || '').replace(/([a-zA-Z0-9\%]+\:[a-zA-Z0-9\%]+\@)/, '');
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
        var requestUrl = this.method + ' ' + this.removeAuthFromString(this.url);

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
        var fileName = sanitize(fileParts[0].substr(0, 30)).replace(/[\,\.]/g,'-');
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
    getFilePath: function (tmp) {
        return (tmp ? this._tmpDir : this._baseDir) + '/' + this.getId();
    },

    /**
     * Get the file path for the body portion of response
     * @returns {string}
     */
    getFilePathBody: function(tmp){
        return this.getFilePath(tmp);//maybe add on a .raw or something
    },

    /**
     * Get the file path for where to store the headers + status, which are written to disk
     * in a single file separate from the body so that the sync read of it is not affected
     * by the size of the actual response, and encoding can be independent of the body encoding
     * @returns {string}
     */
    getFilePathHeaders: function(tmp){
        return this.getFilePath(tmp) + '.json';
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

        //this only creates it if it doesn't exist, global, only done once
        //since synchronous we don't want to do this all the time
        if(!this.directoryCheck){
            try{
                mkdir(this._baseDir);
                mkdir(this._tmpDir);
            }catch(error){
                this.handleUnhandledError(error);
                return;
            }

            this.directoryCheck = true;
        }



        //make sure both files exist
        var headersPath = this.getFilePathHeaders();
        var bodyPath = this.getFilePathBody();
        return existsSync(headersPath) && existsSync(bodyPath);
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
                    'caching-proxy-served-from' : 'Cache',
                    'caching-proxy-folder' : this.options.cacheDir,
                    'caching-proxy-source': this.getId()
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
        try {
            var buffer = File.readFileSync(this.getFilePathHeaders());
        }catch(error){
            this.handleUnhandledError(error);
        }
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

        if(!metaData){
            return false;
        }

        headers['caching-proxy-served-from'] = 'Cache';
        headers['caching-proxy-source'] = this.getId();

        if(!metaData){
            this.sendHeaders(res, 500, {});
            res.end('Unable to parse response headers from disk');
            return;
        }else if(this.serveNoChangeHeaderIfNotModified(req, res, headers)){
            return;
        }

        this.sendCachedResponse(res, metaData.status, metaData.headers);

        return true;
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
        if(!contentType || !contentType.match(/(text|json|xml|javascript)/i)){
            this.sendHeaders(res, status, headers);
            console.log('STREAMING RESPONSE: ' + this.url + ' (' + this.getId() + ')');
            //get the content and stream it back
            try{
                var stream = File.createReadStream(this.getFilePathBody());
                stream.pipe(res);
            }catch(error){
                this.handleUnhandledError(error);
                return;
            }


        //else text, so need to replace content with proxy paths
        }else{
            try{
                var buffer = File.readFileSync(this.getFilePathBody());
            }catch(error){
                this.handleUnhandledError(error);
                return
            }
            var body = buffer && buffer.toString('utf8');
            if(body){
                body = this.updateResponse(body);
            }
            this.responseBody = body;

            var length = Buffer.byteLength(body, 'utf8');

            //send content length only if not chunked
            if(!headers['transfer-encoding']) {
                headers['content-length'] = length;
            }

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
        this.responseHeaders = {
            status: status,
            headers: headers
        };

        try {
            File.writeFileSync(this.getFilePathHeaders(true), JSON.stringify({
                    status: status,
                    headers: headers
                },
                undefined,
                '  '
            ));
        }catch(error){
            this.handleUnhandledError(error);
        }
    },

    /**
     * Overridden by actual unpipe function, the cancel of the proxied request
     */
    unpipe : undefined,

    /**
     * Wires up the IncomingMessage body to the file this.getFilePathBody()
     * and starts piping the data from the message into the file
     * @param incomingMessage
     */
    writeBody: function(incomingMessage){
        var file = this.getFilePathBody(true);
        console.log('FILEWRITE: ' + file);
        try {
            var writeStream = File.createWriteStream(file);
        }catch(error){
            this.handleUnhandledError(error);
            return;
        }
        incomingMessage.pipe(writeStream);

        this.unpipe = incomingMessage.unpipe.bind(incomingMessage, writeStream);
    },

    /**
     * Given data, writes it to this.getFilePathBody() synchronously
     * @param data UTF8 string
     */
    writeBodySync: function(file, data){
        try {
            File.writeFileSync(file, data);
        }catch(error){
            this.handleUnhandledError(error);
            return;
        }
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
        headers = headers || {};

        //remote date header and let NODE send the current date
        delete headers.date;

        res.writeHeader(status, headers);
    },

    /**
     * As soon as the IncomingMessage headers have been received, this method is called
     * and based on the content-type we either (a) for non-text pipe the IncomingMessage
     * response data directly to the disk and to the http.ServerResponse back to the request that
     * is being served
     *
     * @param res The http.ServerResponse being served
     * @param clientRequest The incoming client request
     * @param incomingMessage The http.IncomingMessage that we are receiving from the request we made on behalf of the client and caching
     */
    onData: function(res, clientRequest, incomingMessage){
        incomingMessage.pause();

        this.responseStatus = incomingMessage.statusCode;

        var success = incomingMessage.statusCode === 200 || this.allowedErrors.indexOf(incomingMessage.statusCode) !== -1;
        var headers = incomingMessage.headers;

        this.responseHeaders = {
            status: incomingMessage.statusCode,
            headers: headers
        };

        headers['caching-proxy-served-from'] = 'Fresh/Internet';
        headers['caching-proxy-source'] = this.getId();
        headers['caching-proxy-folder'] = this.options.cacheDir;


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
            incomingMessage.on('end', this.onEndSecure.bind(this, clientRequest, res, incomingMessage));
            incomingMessage.on('data', this.appendData.bind(this));
        }else{
            this.sendHeaders(res, incomingMessage.statusCode, headers);
            incomingMessage.pipe(res);

            //hook up our end with moving of the temp files into the
            //final location from the stream
            incomingMessage.on('end', this.moveTempFiles.bind(this, incomingMessage));
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

        this.responseStatus = incomingMessage.statusCode;

        this.handleUnhandledError(evt);
        return;
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

        var success = incomingMessage.statusCode === 200 || this.allowedErrors.indexOf(incomingMessage.statusCode) !== -1;

        //We only write headers/data upon 100% success in the case of a file that
        //is not being piped
        if(success && !this.aborted) {
            //write to temp body
            this.writeHeaders(incomingMessage.statusCode, incomingMessage.headers);
            this.writeBodySync(this.getFilePathBody(true), this.responseBody);
            this.moveTempFiles(incomingMessage);
        }

        var body = this.updateResponse(this.responseBody);
        var headers = incomingMessage.headers;
        var length = Buffer.byteLength(body, 'utf8');

        headers['content-length'] = length;
        headers['caching-proxy-served-from'] = 'Fresh/Internet';
        headers['caching-proxy-source'] = this.getId();

        this.sendHeaders(res, incomingMessage.statusCode, headers);


        res.end(body);
    },

    /**
     * The secure serving has race conditions present and is not stable/supported at this time
     * @param clientRequest The incoming client request we are servicing
     * @param res
     * @param incomingMessage
     */
    onEndSecure: function(clientRequest, res, incomingMessage){
        this.writeBodySync(this.responseBody);

        var success = incomingMessage.statusCode === 200 || this.allowedErrors.indexOf(incomingMessage.statusCode) !== -1;
        if(success){
            this.moveTempFiles(incomingMessage);
        }

        this.serve(clientRequest, res);
    },

    /**
     * Will replace all http/https absolute URLs with a path back to this caching proxy
     * @param body
     * @returns {XML|string}
     */
    updateResponse: function (body) {
        var url = this.proxyPath;
        console.log('UPDATE RESPONSE: ' + this.url + ' (' + this.getId() + ')');

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
    onOriginalRequestAborted: function (clientRequest, res, request, evt) {
        var reason = evt;
        var args = arguments;

        this.abort(request);

        return;
    },

    abort: function(request){
        this.aborted = true;
        if(this.unpipe){
            this.unpipe();
            this.unpipe = undefined;
        }

        //GIVE UP on the proxied request stream, the user has given up, so let's not linger
        request.abort();

        //DELETE tmp files
        var headers = this.getFilePathHeaders(true);
        var body = this.getFilePathBody(true);

        try {
            this.deleteIfExists(headers);
            this.deleteIfExists(body);
        }catch(error){
            this.handleUnhandledError(error);
        }
    },

    deleteIfExists: function(file){
        //headers
        File.exists(file, function(fileExists) {
            if(!fileExists){
                console.log('DELETE FAIL, FILE DOES NOT EXIST: ', file);
            }else{
                File.unlink(file, function (err) {
                    if (err){
                        console.warn('DELETE FAILED: ' + err, file);
                    }else{
                        console.log('DELETE SUCCESS: ', file);
                    }

                }.bind(this));
            }

        }.bind(this));
    },

    moveTempFiles: function(incomingMessage){
        var success = (incomingMessage.statusCode === 200 || this.allowedErrors.indexOf(incomingMessage.statusCode) !== -1) && !this.aborted;

        if(!success) return;


        //DELETE tmp files
        var headersTmp = this.getFilePathHeaders(true);
        var bodyTmp = this.getFilePathBody(true);
        var headers = this.getFilePathHeaders();
        var body = this.getFilePathBody();

        try {
            //headers
            File.rename(headersTmp, headers, function (headersTmp, err) {
                if (err) {
                    console.warn('HEADERS_PUBLISH failed: ' + err + ", " + headers);
                } else {
                    console.log('HEADERS_PUBLISH succeeded' + headers);
                }

            }.bind(this, headersTmp));

            //body
            File.rename(bodyTmp, body, function (bodyTmp, err) {
                if (err) {
                    console.warn('BODY_PUBLISH failed: ' + err + ", " + body);
                } else {
                    console.log('BODY_PUBLISH succeeded' + body);
                }
            }.bind(this, bodyTmp));
        }catch(error){
            this.handleUnhandledError(error);
        }
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
        console.log('FILECAPTURE: ' + options.fullUrl);

        var requestsLib = options.fullUrl.indexOf('https') === 0 ? https : http;

        var request = this.request = requestsLib.request(options, this.onData.bind(this, res, clientRequest));

        //close event indicates stream was stopped BEFORE the 'end' event
        res.on('close', this.onOriginalRequestAborted.bind(this, clientRequest, res, request));

        //request.on('response', this.onHeaders.bind(this, res, request));
        request.on('error', this.onError.bind(this, res, request));

        if(body){
            request.write(body);//@TODO this does not support chunked posts larger than 1 chunk
            console.log(options.method.toUpperCase() + ' BODY FORWARDED');
        }

        request.end();

    },

    handleUnhandledError: function(error){
        console.error("An unhandled error occured fulfilling this request, " + error, this.url);
        var code = error.code && parseInt(error.code, 10);
        var code = !isNaN(code) ? code : 500;

        this.res.writeHead(code, {
            'caching-proxy-served-from' : 'Fresh',
            'caching-proxy-folder' : this.options.cacheDir,
            'content-type': 'application/json',
            'caching-proxy-source': this.getId()
        });

        this.res.end(JSON.stringify({
            'Error':'An unexpected error occured in the CachingProxy: ' + error,
            'Url': this.url,
            'ResponseStatusCode': this.statusCode,
            'IsSecureRequest': this.secure,
            'RequestHeaders': this.requestHeaders,
            'ResponseHeaders': this.responseHeaders
        }));
    }

}
//);
/**
 * export the Cache class
 */

module.exports = Cache;