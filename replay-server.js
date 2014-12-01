/**
 * Options
 * -d run as a daemon, exiting the parent process immediately upon starting up the replay-server
 * -p <port number> the port to run on, the default is 8092
 * -c run in capture MODE (default mode if no MODE is provided)
 * -r run in replay MODE
 */

var http = require("http");
var replay = require("replay");

// parse arguments
var argv = require('minimist')(process.argv.slice(2));
console.log('Running with parameters: ' + JSON.stringify(argv));

const PORT = (argv && argv.p) ? argv.p : 8092;
const ADDR = '0.0.0.0';

var mode = (argv && argv.r) ? 'replay' : 'capture';

// Check for daemon mode
if (argv && argv.d) {

    var daemon = require("daemon");
    console.log('Running in daemon mode... (PID '+(process && process.pid)+')');
}


console.log('Here we go!');

var server = http.createServer(function (req, res) {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('Hello World\n');
});

server.listen(PORT, ADDR, function () {
    console.log('Server running at http://%s:%d/', ADDR, PORT);
    console.log('Press CTRL+C to exit');
});