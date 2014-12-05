/**
 * Options
 * -d running as a daemon, this is more for introspection, pass this in if you are firing us up as a daemon
 * -p <port number> the port to run on, the default is 8092
 */



var args = require('optimist').argv,
    port = isNaN(parseInt(args.p, 10)) ? 8092 : args.p,
    isReplay = args.r || false,
    isCapture = args.c || !isReplay,
    isDaemon = args.d || false,
    path = require("path"),
    dir = (args.dir && args.dir.trim()) || __dirname + '/../data';

var http = require('http'),
    url = require('url'),
    util = require('util'),
    Cache = require('./cache');



/**
 * CachingProxy is a class for greedily caching proxied content for
 * unstable API servers, demos, tradeshows, load testing (browser, not APIs), etc.
 *
 * @param options {port: Number, dir: String}
 * @constructor
 */
var CachingProxy = function(options) {
    options = options || {};

    var SERVER = {
        PORT: options.port || port,
        IS_DAEMON: isDaemon,
        EXCLUDED_HEADERS: '',
        ADDRESS: {},
        DIR: path.resolve(options.dir || dir),

        handler: function (req, res) {
            //is this a health check?
            if (SERVER.handleSpecialCases(req, res)) {
                return;
            }

            if (!req.headers || !req.headers['content-length']) {
                SERVER.onRequestReceived(req, res);
            } else {
                console.log('POST');
                var body = '';
                req.on('data', function (data) {
                    body += data;
                    console.log('POST PARTIAL BODY: ' + body);
                });
                req.on('end', function () {
                    console.log('POST FULL BODY: ' + body);
                    req.body = body;
                    SERVER.onRequestReceived(req, res);
                });
            }
        },

        onRequestReceived: function (req, res) {
            var options = SERVER.toRequest(req);
            //console.log('NEW REQUEST: ', JSON.stringify(options));

            var proxyPath = req.headers.host;
            if (!proxyPath) {
                proxyPath = SERVER.ADDRESS.address + ':' + SERVER.ADDRESS.port;
            }

            var cache = new Cache({
                url: options.fullUrl,
                headers: options.headers,
                body: req.body,
                dir: SERVER.DIR,
                method: options.method,
                proxyPath: 'http://' + proxyPath + '/'
            });


            if (!cache.exists()) {
                cache.captureThenServe(req, res, options)
            } else {
                cache.serve(req, res);
            }

            return;


            var proxyRequest = http.request(options, SERVER.onResponse.bind(this, req, res));
            proxyRequest.on('response', SERVER.onHeaders.bind(this, req, res, ifModifiedSince));
            proxyRequest.on('error', SERVER.onError.bind(this, req, res, proxyRequest));

            if (req.data) {
                proxyRequest.write(req.data);
            }

            proxyRequest.end();
        },

        /**
         * Handles special cases,
         *  1) Liveness check
         *  2)
         * @param req
         * @param res
         * @returns {boolean}
         */
        handleSpecialCases: function (req, res) {
            if (req.url.match(/^\/ping/)) {
                console.warn('(handleSpecialCases) Serving 200, pong');
                res.writeHead(200);
                res.end('pong');
                return true;
            } else if (req.url.indexOf('/http') !== 0) {
                console.warn('(handleSpecialCases) Serving 404, not absolute URL: ' + req.url);
                res.setHeader('404', {'content-type': 'text/plain'});
                res.end('The URL provided to replay-server was not absolute, and relative paths cannot be resolved by it (' + req.url + ')\n');
                return true;
            }

            return false;
        },

        onCacheResponse: function (req, res, cachedData) {

        },

        onHeaders: function (req, res, ifModifiedSince, response) {
            //console.log('RESPONSE!!!', ifModifiedSince, response.headers)
            if (ifModifiedSince) {
                if (!response.headers['last-modified']) {
                    return;
                }

                var ifModified = (new Date(ifModifiedSince)).getTime();
                var lastModified = (new Date(response.headers['last-modified'])).getTime();

                console.log('ifModifiedSince', ifModifiedSince, ifModified, lastModified, lastModified > ifModified);
                if (lastModified <= ifModified && false) {
                    console.log('(onHeaders) Serving 304, ' + lastModified + '<=' + ifModified);
                    res.writeHead(304);
                    res.end();

                    //replay ProxyRequest() does not support abort(), so flag it manually
                    response.aborted = true;
                    return;
                }


            }
        },

        onResponse: function (req, res, response) {
            var data = ''

            var handleResponse = function () {
                if (!response.aborted) {
                    SERVER.onSuccess(req, res, response, data);
                } else {
                    console.log('(onResponse) Serving nothing, request already serviced');
                }
            };

            response.on('end', handleResponse);
            response.on('data', function (chunk) {
                data += chunk;
            });

        },

        onSuccess: function (req, res, proxyRequest, data) {
            //console.log('END: ' + data.length, proxyRequest.url);//Object.keys(proxyRequest));
            console.log('(onSuccess) Serving ' + proxyRequest.statusCode + ' for ' + req.fullUrl);

            //proxyRequest.headers['content-length'] =

            res.writeHead(proxyRequest.statusCode, proxyRequest.headers || {});

            var responseData = data, contentType = proxyRequest.headers && proxyRequest.headers['content-type'];
            console.log('response headers', proxyRequest);
            if (contentType && contentType.match(/(text|json|xml)/i)) {
                console.log('serving binary data');
                res.end(responseData, 'binary');
                console.log('done serving binary data');
            } else {
                responseData = SERVER.updateResponse(req, data);
                res.end(responseData);
            }


        },

        onError: function (req, res, proxyRequest, evt) {
            console.warn('(onError) Serving ' + evt.code + ' for ' + proxyRequest.url);
            res.writeHead(evt.code, proxyRequest.headers || {});
            res.end(evt.message);
        },


        updateResponse: function (req, body) {
            var url = 'http://' + SERVER.ADDRESS.address + ':' + SERVER.ADDRESS.port + '/';

            body = body.replace(/http\:\/\//g, url + 'http/');
            body = body.replace(/https\:\/\//g, url + 'https/');

            return body;
        },


        /**
         * Options:
         * @param req
         * @returns options
         *      host: A domain name or IP address of the server to issue the request to. Defaults to 'localhost'.
         *      hostname: To support url.parse() hostname is preferred over host
         *      port: Port of remote server. Defaults to 80.
         *      localAddress: Local interface to bind for network connections.
         *      socketPath: Unix Domain Socket (use one of host:port or socketPath)
         *      method: A string specifying the HTTP request method. Defaults to 'GET'.
         *      path: Request path. Defaults to '/'. Should include query string if any. E.G. '/index.html?page=12'
         *      headers: An object containing request headers.
         *      auth: Basic authentication i.e. 'user:password' to compute an Authorization header.
         *      agent: Controls Agent behavior. When an Agent is used request will default to Connection: keep-alive. Possible values:
         *          undefined (default): use global Agent for this host and port.
         *          Agent object: explicitly use the passed in Agent.
         *          false: opts out of connection pooling with an Agent, defaults request to Connection: close.
         */
        toRequest: function (req) {

            var requestUrl = SERVER.cleanRequestUrl(req.url),
                requestParams = url.parse(requestUrl),
                https = requestParams.href.indexOf('https') === 0,
                options = {},
                headers = util._extend({}, req.headers || {});
            ;


            //console.log('https=' + https, ', original url=' + req.url + ' new url=' + requestUrl + ', params', requestParams);

            //override host
            if (headers.Host) {
                headers.Host = requestParams.hostname;
            } else {
                headers.host = requestParams.hostname;
            }

            delete headers['accept-encoding'];

            options.host = requestParams.hostname;
            options.port = requestParams.port ? requestParams.port : (https ? 443 : 80);
            options.method = req.method;
            options.path = requestParams.path;
            options.headers = headers;
            options.fullUrl = requestUrl;

            if (requestParams.auth) {
                //options.auth = requestParams.auth;
                var auth = requestParams.auth.split(':');
                var username = auth[0];
                var password = auth[1];
                options.headers.authorization = 'Basic ' + new Buffer(username + ':' + password).toString('base64');
            }

            //console.log('Request Options: ', options);

            req.fullUrl = requestUrl;

            return options;
        },

        /**
         * Given a URL string, clean it of any standard randomization tokens generally
         * associated with cache busters
         *
         * @param url {String}
         * @returns {string}
         */
        cleanRequestUrl: function (url) {
            var cleanedUrl = url.replace('/http/', 'http://').replace('/https/', 'https://');
            cleanedUrl = cleanedUrl.replace(/rand\=[a-z0-9][\&]*/i, '');
            cleanedUrl = cleanedUrl.replace(/[\&\?][0-9]+[\&]*$/i, '');

            console.log('cleanedUrl: ' + cleanedUrl);

            return cleanedUrl;
        }


    }

    console.log('Starting a caching proxy server on port ' + SERVER.PORT + ', data dir=' + SERVER.dir);

    //Listen for all requests
    var server = http.createServer(SERVER.handler);
    server.listen(SERVER.PORT);

    SERVER.ADDRESS = server.address();
};


CachingProxy.start = function(){
    new CachingProxy();
}

module.exports = CachingProxy;