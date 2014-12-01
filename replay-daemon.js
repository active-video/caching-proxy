/**
 * Options
 * -d run as a daemon, exiting the parent process immediately upon starting up the replay-server
 * -p <port number> the port to run on, the default is 8092
 * -c run in capture MODE (default mode if no MODE is provided)
 * -r run in replay MODE
 */

var http = require("http"),
    replay = require("replay"),
    ps = require('ps-node');

// parse arguments
var argv = require('minimist')(process.argv.slice(2));
console.log('Running with parameters: ' + JSON.stringify(argv));

const PORT = (argv && argv.p) ? argv.p : 8092;
const ADDR = '0.0.0.0';

var mode = (argv && argv.r) ? 'replay' : 'capture';

// Check for daemon mode
if (argv && argv.d) {

    // Check if process exists
    ps.lookup({
        command: 'node',
        arguments: ['replay-daemon.js','-d']
    }, function(err, resultList ) {
        if (err) {
            throw new Error( err );
        }

        var runCount = 0;

        resultList.forEach(function( process ){
            if (process) {

                // console.log( 'PID: %s, COMMAND: %s, ARGUMENTS: %s', process.pid, process.command, process.arguments );

                runCount++;

                if (runCount > 1) {
                    throw new Error("replay-daemon is already running!");
                }
            }
        });

        main();
    });
}


var main = function() {

    console.log('Here we go!');

    var daemon = require("daemon");
    console.log('Running in daemon mode... (PID '+(process && process.pid)+')');

    var server = http.createServer(function (req, res) {
        res.writeHead(200, {'Content-Type': 'text/plain'});
        res.end('Hello World\n');
    });

    server.listen(PORT, ADDR, function () {
        console.log('Server running at http://%s:%d/', ADDR, PORT);
        console.log('Press CTRL+C to exit');
    });

};