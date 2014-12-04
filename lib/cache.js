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

exists = File.exists || Path.exists,
existsSync = File.existsSync || Path.existsSync,

mkdir = function (pathname, callback) {
    return exists(pathname, function (found) {
        var parent;
        if (found) {
            callback(null);
            return;
        }
        parent = Path.dirname(pathname);
        return exists(parent, function (found) {
            if (found) {
                return File.mkdir(pathname, callback);
            } else {
                return mkdir(parent, function () {
                    return File.mkdir(pathname, callback);
                });
            }
        });
    });
};


/**
 *
 * @param options {Object} url, headers. body
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

    proxyPath : null,

    responseBody : null,

    init: function (options) {
        this.options = options || {};

        // always initialize all instance properties
        this.dir = this.options.dir || undefined;
        this._baseDir = Path.resolve(this.dir || "data/cache");
        this._id = undefined;
        this.proxyPath = this.options.proxyPath;

        this.method = this.options.method || "GET";
        this.url = this.options.url;
        this.requestHeaders = this.options.headers;
        this.requestBody = this.options.body;

        this.secure = this.url.indexOf('https') === 0;


        this._exists = this.exists();
    },

    removeAuthFromString : function(str){
        return (str || "").replace(/([a-zA-Z0-9\%]+\:[a-zA-Z0-9\%]+\@)/, '');
    },

    getId: function () {
        if(this._id !== undefined){
            return this._id;
        }

        //the URL should remove any basic auth from it, to be agnostic of HTTP auth if it is later removed from the server
        var requestUrl = this.method + " " + this.removeAuthFromString(this.url);
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

    getFilePath: function () {
        return this._baseDir + "/" + this.getId();
    },

    getFilePathBody: function(){
        return this.getFilePath();//maybe add on a .raw or something
    },

    getFilePathHeaders: function(){
        return this.getFilePath() + ".json";
    },

    exists: function () {
        if (this._exists !== undefined) {
            return this._exists;
        }else if(FORCE_DOWNLOAD){
            return false;
        }

        var path = this.getFilePathHeaders();
        return existsSync(path);
    },

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
                res.writeHead(304);
                res.end();
                return true;
            }
        }

        return false;
    },

    getHeadersFromFile : function(){
        var buffer = File.readFileSync(this.getFilePathHeaders());
        var metaDataString = buffer && buffer.toString('utf8');
        var metaData = metaDataString && JSON.parse(metaDataString);

        return metaData || undefined;
    },

    serve: function(req, res){
        var metaData = this.getHeadersFromFile(),
            headers = metaData && metaData.headers;

        if(!metaData){
            this.sendHeaders(res, 500, {});
            res.end("Unable to parse response headers from disk");
            return;
        }else if(this.serveNoChangeHeaderIfNotModified(req, res, headers)){
            return;
        }

        this.sendCachedResponse(res, metaData.status, metaData.headers);
    },

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

    writeHeaders: function(status, headers){
        File.writeFileSync(this.getFilePathHeaders(), JSON.stringify({
                status: status,
                headers: headers
            },
            undefined,
            '  '
        ));
    },

    writeBody: function(incomingMessage){
        console.log("FILEWRITE: " + this.getFilePathBody());
        var writeStream = File.createWriteStream(this.getFilePathBody());
        incomingMessage.pipe(writeStream);
    },

    writeBodySync: function(data){
        File.writeFileSync(this.getFilePathBody(), data);
    },

    appendData: function(chunk){
        this.responseBody += chunk;
    },

    sendHeaders: function(res, status, headers){
        res.writeHeader(status, headers);
    },

    onData: function(res, incomingMessage){
        incomingMessage.pause();

        var success = incomingMessage.statusCode === 200;

        var contentType = incomingMessage.headers && incomingMessage.headers['content-type'];

        if(contentType && contentType.match(/(text|json|xml)/i)){
            this.responseBody = '';
            incomingMessage.on('end', this.onEnd.bind(this, res, incomingMessage));
            incomingMessage.on('data', this.appendData.bind(this));
        }else if(this.secure){
            this.responseBody = '';
            incomingMessage.on('end', this.onEndSecure.bind(this, res, incomingMessage));
            incomingMessage.on('data', this.appendData.bind(this));
        }else{
            this.sendHeaders(res, incomingMessage.statusCode, incomingMessage.headers);
            incomingMessage.pipe(res);

        }

        //pipe to the file system as well
        if(success){
            this.writeHeaders(incomingMessage.statusCode, incomingMessage.headers);
            this.writeBody(incomingMessage);
        }

        incomingMessage.resume();
    },

    onError: function(res, incomingMessage, evt){
        console.warn('ERROR WITH PROXY REQUEST ' + (evt.code || 'Unknown') + ', ' + evt.message +' (for url= '+this.url + ')');

        res.writeHead(evt.code || 500, incomingMessage.headers || {});
        res.end(evt.message || "Unknown Cache Proxy Error");
    },

    onEnd: function(res, incomingMessage){
        this.writeBodySync(this.responseBody);

        var body = this.updateResponse(this.responseBody);
        var headers = incomingMessage.headers;
        var length = Buffer.byteLength(body, 'utf8');

        headers['content-length'] = length;

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

    updateResponse: function (body) {
        var url = this.proxyPath;
        console.log("UPDATE RESPONSE: " + this.url);

        body = body.replace(/http\:\/\//g, url  + 'http/');
        body = body.replace(/https\:\/\//g, url  + 'https/');

        return body;
    },

    captureThenServe : function(res, options){
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
// export the class
module.exports = Cache;