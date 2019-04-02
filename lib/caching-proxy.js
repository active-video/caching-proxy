/**
 * Options
 * -d directory to save cached data to
 * -p <port number> the port to run on, the default is 8092
 * -e <CSV exclusions> a comma separated list of URL parameters to exclude from the hash, for example rand,cache-buster, etc (will still be included in proxied request, just not used when determining if this request matches a previous one)
 * -s Expose the status API via /status, default is not to if this flag is omitted. If -s is present, then /status will show all pending request as JSON
 * -b Comma separated list of allowed error headers, default is to cache 404 errors
 * -t if 'true' use temporary file only, do not save a cached copy (only transform requests/responses and proxy), default is 'false'.
 * -proxyHost "proxy host", ip or hostname only
 * -proxyPort "proxy port"
 */



var args = require('optimist').argv,
    port = isNaN(parseInt(args.p, 10)) ? 8092 : args.p,
    path = require('path'),
    exclude = (args.e && args.e.trim && args.e.trim()) || '',
    dir = (args.d && args.d.trim && args.d.trim()) || __dirname + '/../data',
    allowedErrors = !args.b ? '404' : (args.b && args.b.toString && args.b.toString().trim()),
    dir = (args.d && args.d.trim && args.d.trim()) || __dirname + '/../data',
    passthrough = (args.T && args.T === 'true') || false,
    proxyHost = args.proxyHost,
    proxyPort = args.proxyPort,

    http = require('http'),
    url = require('url'),
    util = require('util'),
    dateFormat = require('dateformat'),
    Cache = require('./cache'),
    requests = {},

    exposeRequestStatus = (args.s || false);

var HttpsProxyAgent = require('https-proxy-agent');


console.warn('proxy parent: ' + proxyHost + ':' + proxyPort);

    // Console log override with timestamp
    if (console && console.log) {
        originalconsolelog = console.log.bind(console);
        console.log = function () {
            var timestamp = dateFormat("yyyy-mm-dd HH:MM:ss:l");
            Array.prototype.unshift.call(arguments, '[' + timestamp + '] ');
            originalconsolelog.apply(this, arguments);
        }
    }

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
        EXCLUDED_HEADERS: '',
        ADDRESS: {},
        DIR: path.resolve(options.dir || dir),
        EXCLUDE: (options.exclude || exclude).split(','),
        ALLOWED_ERRORS: allowedErrors,
        PASSTHROUGH: typeof options.passthrough === 'boolean' ? options.passthrough : passthrough,

        handler: function (req, res) {
            //console.log("caching-proxy.handler()");
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
                    console.log("caching-proxy.handler() - POST PARTIAL BODY: " + body);
                });
                req.on('end', function () {
                    console.log("caching-proxy.handler() - POST FULL BODY: " + body);
                    req.body = body;
                    SERVER.onRequestReceived(req, res);
                });
            }
        },

        onRequestReceived: function (req, res) {
            console.log("caching-proxy.onRequestReceived()");
            var options = SERVER.toRequest(req);
            //console.log('NEW REQUEST: ', JSON.stringify(options));

            var proxyPath = req.headers.host;
            if (!proxyPath) {
                proxyPath = SERVER.ADDRESS.address + ':' + SERVER.ADDRESS.port;
            }

            proxyPath = 'http://' + proxyPath + '/';

            if(options.cacheDir){
                proxyPath += options.cacheDir + '/';
            }

            var cache = new Cache({
                url: options.fullUrl,
                headers: options.headers,
                body: req.body,
                dir: SERVER.DIR + "/" + options.cacheDir,
                method: options.method,
                exclude: SERVER.EXCLUDE,
                proxyPath: proxyPath,
                cacheDir: options.cacheDir,
                allowedErrors: (allowedErrors || '').split(','),
                passthrough: SERVER.PASSTHROUGH
            }, res);


            var served = false;
            if(cache.exists()){
                served = cache.serve(req, res);
            }

            if (!served || !cache.exists()) {
                res.on('finish', function(){
                    delete requests[options.fullUrl];
                });

                requests[options.fullUrl] = Date.now();
                try{
                    cache.captureThenServe(req, res, options)
                }catch(eUnhandled){
                    cache.handleUnhandledError(eUnhandled);
                }

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
         *  1) Liveness check /status
         *  2) Ping check /ping
         *  3) relative URLs
         * @param req
         * @param res
         * @returns {boolean}
         */
        handleSpecialCases: function (req, res) {
            console.log("caching-proxy.handleSpecialCases()");
            var parts = req.url.split('/');
            if (req.url.match(/^\/ping/)) {
                console.warn('(handleSpecialCases) Serving 200, pong');
                res.writeHead(200);
                res.end('pong');
                return true;
            } else if(req.url.match(/^\/status/)){
                this.serveStatus(req, res);
                return true;
            } else if (parts[1].indexOf('http') !== 0 && (!parts[2] || parts[2].indexOf('http') !== 0)) {
                console.warn('(handleSpecialCases) Serving 404, not absolute URL: ' + req.url);
                res.writeHeader('404', {'content-type': 'text/plain'});
                res.end('The URL provided to replay-server was not absolute, and relative paths cannot be resolved by it (' + req.url + ')\n');
                return true;
            }

            return false;
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
            //console.log("caching-proxy.toRequest()");

            var requestUrl = SERVER.cleanRequestUrl(req.url),
                requestParams = url.parse(requestUrl),
                https = requestParams.href.indexOf('https') === 0,
                options = {},
                headers = util._extend({}, req.headers || {}),
                requestCacheDir = "default"
            ;


            if(req.url.indexOf('/http') !== 0){
                var parts = req.url.split('/');
                requestCacheDir = parts[1];
            }

            requestCacheDir = requestCacheDir.toLowerCase().replace(/[^a-z0-9\-\_]/ig, '');


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
            options.cacheDir = requestCacheDir;


            //parent proxy in front of us? i.e. route requests through squid or apache traffic server?
            if(proxyHost && https) {
                options.agent = new HttpsProxyAgent(url.parse('http://' + proxyHost + ':' + proxyPort));
            } else if(proxyHost) {
                options.host = proxyHost;
                options.port = proxyPort;
            }

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
            //console.log("caching-proxy.cleanRequestUrl()");
            var parts = url.split('/');
            if(parts[1] === 'http' || parts[1] === 'https'){
                var cleanedUrl = url.replace(/^\/http\//, 'http://').replace(/^\/https\//, 'https://');
            }else{
                url = "/" + parts.slice(2).join('/');
                var cleanedUrl = url.replace(/^\/http\//, 'http://').replace(/^\/https\//, 'https://');
            }


            return cleanedUrl;
        },

        serveStatus : function(req, res){
            //console.log("caching-proxy.serveStatus()");

            if(!exposeRequestStatus){
                console.log("caching-proxy.serveStatus() - caching-proxy service needs to start the \"-s\" flag in order to turn on the status service");
                res.writeHeader('403', {'content-type': 'application/json'});
                res.end(JSON.stringify({'error':'You need to start the caching proxy service with the "-s" flag in order to turn on the status service.'}, undefined, '  '));
                return;
            }

            var r = requests;

            res.writeHeader('200', {'content-type': 'application/json'});
            res.end(JSON.stringify(r, undefined, '  '));
        }


    }

    console.log(
            'Starting a CachingProxy server\n\tPORT='
            + SERVER.PORT + ', \n\tBASE DATA DIR: '
            + SERVER.DIR +'\n\tEXCLUSIONS: ' + (SERVER.EXCLUDE.join(',') || '(Not Applicable, No Exclusions)')
            + '\n\tAllowed Errors: ' + SERVER.ALLOWED_ERRORS
            + '\n\tTemp Only (do not save cached files to disk permanently): ' + SERVER.PASSTHROUGH
            + '\n\tStatus Service via /status: ' + (exposeRequestStatus ? 'ON' : 'OFF') + ''
            + '\n\tRoute Requests through localhost, or by IP:'
                + '\n\t\thttp://localhost:' + SERVER.PORT + '/http/yourUrl.com?your=parameters&go=here'
            + '\n\tAlternatively before the /http/, include a unique name, to force data into a folder' + SERVER.DIR + '/\<unique-name\>:'
                + '\n\t\thttp://localhost:' + SERVER.PORT + '/<unique-name>/http/yourUrl.com?your=parameters&go=here'
    );

    //Listen for all requests
    var server = http.createServer(SERVER.handler);
    server.listen(SERVER.PORT);

    SERVER.ADDRESS = server.address();
};


CachingProxy.start = function(){
    new CachingProxy();
}

module.exports = CachingProxy;
