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
    isDaemon = args.d || false;

var http = require('http'),
    replay = require('replay'),
    url = require('url');

replay.mode = isReplay ? "replay" : "record";
replay.fixtures = __dirname + "/fixtures/replay";
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
        if (req.url.match(/^\/ping/)) {
            res.writeHead(200);
            res.end('pong\n');
            return;
        }

        var options = SERVER.toRequest(req);
        console.log('NEW REQUEST: ', JSON.stringify(options));

        var proxyRequest = http.request(options, SERVER.onResponse.bind(this, req, res));
        proxyRequest.on('error', SERVER.onError.bind(this, req, res, proxyRequest));

        if(req.data){
            proxyRequest.write(req.data);
        }

        proxyRequest.end();
    },

    onResponse: function (req, res, response) {
        var data = ''

        var handleResponse = function () {
            SERVER.onSuccess(req, res, response, data);
        };

        response.on('end', handleResponse);
        response.on('data', function (chunk) {
            data += chunk;
        });

    },

    onSuccess : function(req, res, proxyRequest, data){
        console.log('END: ' + data.length, proxyRequest.url);//Object.keys(proxyRequest));
        //console.log('Response headers: ', proxyRequest.headers);

        res.writeHead(proxyRequest.statusCode, proxyRequest.headers || {});

        //write headers
        res.end(SERVER.updateResponse(req, data));
    },

    onError : function(req, res, proxyRequest, evt){
        console.log("onError", evt )
        res.writeHead(evt.code, proxyRequest.headers || {});
        res.end(evt.message);
    },


    updateResponse: function (req, body) {
        var url = 'http://' + SERVER.ADDRESS.address + ":" + SERVER.ADDRESS.port + "/";

        body = body.replace(/http\:\/\//g, url  + "http/");
        body = body.replace(/https\:\/\//g, url  + "https/");

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

        var requestUrl = req.url.replace('/http/', 'http://').replace('/https/', 'https://'),
            requestParams = url.parse(requestUrl),
            https = requestParams.href.indexOf('https') === 0,
            options = {},
            headers = req.headers || {};

        //console.log('https=' + https, ', original url=' + req.url + ', params', requestParams);

        //override host
        if (headers.Host) {
            headers.Host = requestParams.hostname;
        } else {
            headers.host = requestParams.hostname;
        }

        headers['accept-encoding'] = null;



        options.host = requestParams.hostname;
        options.port = requestParams.port ? requestParams.port : (https ? 443 : 80);
        options.method = req.method;
        options.path = requestParams.path;
        options.headers = headers;

        if (requestParams.auth) {
            options.auth = requestParams.auth;
        }

        return options;
    }


}


//Listen for all requests
var server = http.createServer(SERVER.handler);
server.listen(SERVER.PORT);

SERVER.ADDRESS = server.address();