/**
 * Options
 * -d run as a daemon, exiting the parent process immediately upon starting up the replay-server
 * -p <port number> the port to run on, the default is 8092
 * -c run in capture MODE (default mode if no MODE is provided)
 * -r run in replay MODE
 */



var args = require('optimist').argv,
    port = args.p || 8092,
    isReplay = args.r || false,
    isCapture = args.c || !isReplay,
    isDaemon = args.d || false,
    dir = args.dir || __dirname + '/data/replay';

var http = require('http'),
    replay = require('replay'),
    url = require('url');

replay.mode = isReplay ? 'replay' : 'record';
replay.fixtures = dir;
replay.debug=true;



console.log('isReplay=' + isReplay + ', isCapture=' + isCapture + ', isDaemon=' + isDaemon + ', port=' + port, 'args=', args);


var SERVER = {
    PORT: port,
    IS_REPLAY: isReplay,
    IS_CAPTURE: isCapture,
    IS_DAEMON: isDaemon,
    EXCLUDED_HEADERS: '',
    ADDRESS : {},

    handler: function (req, res) {
        //is this a health check?
        if(SERVER.handleSpecialCases(req, res)){
            return;
        }

        //we can manually serve 304's
        var ifModifiedSince = req && req.headers && req.headers['if-modified-since'];

        var options = SERVER.toRequest(req);
        //console.log('NEW REQUEST: ', JSON.stringify(options));

        var proxyRequest = http.request(options, SERVER.onResponse.bind(this, req, res));
        proxyRequest.on('response', SERVER.onHeaders.bind(this, req, res, ifModifiedSince));
        proxyRequest.on('error', SERVER.onError.bind(this, req, res, proxyRequest));

        if(req.data){
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
            res.end('pong\n');
            return true;
        } else if (req.url.indexOf('/http') !== 0) {
            console.warn('(handleSpecialCases) Serving 404, not absolute URL: ' + req.url);
            res.setHeader('404', {'content-type': 'text/plain'});
            res.end('The URL provided to replay-server was not absolute, and relative paths cannot be resolved by it (' + req.url +')\n');
            return true;
        }

        return false;
    },

    onHeaders: function (req, res, ifModifiedSince, response) {
        //console.log('RESPONSE!!!', ifModifiedSince, response.headers)
        if (ifModifiedSince) {
            if(!response.headers['last-modified']){
                return;
            }

            var ifModified = (new Date(ifModifiedSince)).getTime();
            var lastModified = (new Date(response.headers['last-modified'])).getTime();

            console.log('ifModifiedSince', ifModifiedSince, ifModified, lastModified, lastModified > ifModified);
            if(lastModified <= ifModified && false){
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
            if(!response.aborted){
                SERVER.onSuccess(req, res, response, data);
            }else{
                console.log("(onResponse) Serving nothing, request already serviced");
            }
        };

        response.on('end', handleResponse);
        response.on('data', function (chunk) {
            data += chunk;
        });

    },

    onSuccess : function(req, res, proxyRequest, data){
        //console.log('END: ' + data.length, proxyRequest.url);//Object.keys(proxyRequest));
        console.log('(onSuccess) Serving ' + proxyRequest.statusCode + ' for ' + req.fullUrl);

        //proxyRequest.headers['content-length'] =

        res.writeHead(proxyRequest.statusCode, proxyRequest.headers || {});

        var responseData = data, contentType = proxyRequest.headers && proxyRequest.headers['content-type'];
        console.log("response headers", proxyRequest);
        if(contentType && contentType.match(/(text|json|xml)/i)){
            console.log("serving binary data");
            res.end(responseData, 'binary');
            console.log("done serving binary data");
        }else{
            responseData = SERVER.updateResponse(req, data);
            res.end(responseData);
        }


    },

    onError : function(req, res, proxyRequest, evt){
        console.warn('(onError) Serving ' + evt.code + ' for ' + proxyRequest.url);
        res.writeHead(evt.code, proxyRequest.headers || {});
        res.end(evt.message);
    },


    updateResponse: function (req, body) {
        var url = 'http://' + SERVER.ADDRESS.address + ':' + SERVER.ADDRESS.port + '/';

        body = body.replace(/http\:\/\//g, url  + 'http/');
        body = body.replace(/https\:\/\//g, url  + 'https/');

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
            headers = req.headers || {};

        //console.log('https=' + https, ', original url=' + req.url + ' new url=' + requestUrl + ', params', requestParams);

        //override host
        if (headers.Host) {
            headers.Host = requestParams.hostname;
        } else {
            headers.host = requestParams.hostname;
        }

        delete headers['accept-encoding'];

        //replay matches this header, but we want to be able to serve
        //the original 200 with body even if the consumer
        //has never requested it since the original capture
        //meaning the if-modified-since provides us with
        //an inability to just serve a 304 unless a 304 was previouslly
        //captured
        delete headers['if-modified-since'];



        options.host = requestParams.hostname;
        options.port = requestParams.port ? requestParams.port : (https ? 443 : 80);
        options.method = req.method;
        options.path = requestParams.path;
        options.headers = headers;

        if (requestParams.auth) {
            //options.auth = requestParams.auth;
            var auth = requestParams.auth.split(':');
            var username = auth[0];
            var password = auth[1];
            options.headers.authorization = 'Basic ' + new Buffer(username + ':' + password).toString('base64');
        }

        //console.log("Request Options: ", options);

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

        console.log("cleanedUrl: " + cleanedUrl);

        return cleanedUrl;
    }


}


//Listen for all requests
var server = http.createServer(SERVER.handler);
server.listen(SERVER.PORT);

SERVER.ADDRESS = server.address();