/**
 * Options
 * -d run as a daemon, exiting the parent process immediately upon starting up the replay-server
 * -p <port number> the port to run on, the default is 8092
 * -c run in capture MODE (default mode if no MODE is provided)
 * -r run in replay MODE
 */

var http        = require("http"),
    ps          = require('ps-node'),
    replay      = require("replay"),
    httpsync    = require('httpsync');

// parse arguments
var argv = require('minimist')(process.argv.slice(2));
console.log('Running with parameters: ' + JSON.stringify(argv));

const PORT = (argv && argv.p) ? argv.p : 8092;
const ADDR = '0.0.0.0';
const ARG_DAEMON = '-d';

var mode = (argv && argv.r) ? 'replay' : 'capture';

// Check for daemon mode
if (argv && argv.d) {

    var thisPID = process && process.pid;
    console.log( 'This PID is ' + thisPID );

    // Check if process exists
    ps.lookup({
        command: 'node',
        arguments: 'replay-daemon.js',
        psargs: 'u' // added user column as installing module 'httpsync' corrupts parsing the table by omitting the first column
    },
    function(err, resultList ) {

        if (err) {
            throw new Error( err );
        }

        console.log('Checking for existing instances...');

        resultList.forEach(function(prcss){

            // Check if it's not the current process
            if (prcss && prcss.pid != thisPID) {

                console.log( 'Found PID: %s, COMMAND: %s, ARGUMENTS: %s', prcss.pid, prcss.command, prcss.arguments );

                var isRunningAsDaemon = false;
                // Check if it's running with daemon flag
                for (var x=prcss.arguments.length; x>0; x--) {

                    if (prcss.arguments[x-1] == ARG_DAEMON) {
                        isRunningAsDaemon = true;
                    }
                }

                // if there is another existing instance
                if (isRunningAsDaemon) {

                    console.log("This is another daemon instance, check if it's alive...");

                    // Run health check
                    var hcIsAlive = false;
                    var hcOptions = {
                        url: 'http://' + ADDR + ':' + PORT + '/ping/',
                        method: 'GET',
                        timeout: 5,
                        connectionTimeout: 5
                    };
                    var reqHealthCheck = httpsync.request(hcOptions);
                    var timeoutHealthCheck = false;
                    try {
                        var respHealthCheck = reqHealthCheck.end();
                    } catch (e) {
                        timeoutHealthCheck = true;
                    }

                    if (!timeoutHealthCheck) {

                        // Check for response
                        if (respHealthCheck.statusCode == 200) {

                            // Check for response data
                            if (respHealthCheck.data == 'pong') {
                                hcIsAlive = true;
                                console.log('Received PONG, existing instance is alive.');
                            }
                        }
                    }

                    if (hcIsAlive) {
                        // Existing instance is alive, stop this one
                        throw new Error("replay-daemon is already running!");
                    } else {
                        // Existing instance is not responding, kill it
                        console.log('Killing instance with PID '+prcss.pid+'...');
                        ps.kill(prcss.pid, function( err ) {
                            if (err) {
                                console.log('Could NOT kill PID '+prcss.pid+'!');
                                throw new Error( err );
                            } else {
                                console.log('Hanging instance with PID '+prcss.pid+' has been killed!');
                            }
                        });
                    }
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

        // uncomment setTimeout to test the case where thread is hanging
        // setTimeout(function() {
            res.writeHead(200, {'Content-Type': 'text/plain'});
            res.end('pong');
        // }, 7000);
    });

    server.listen(PORT, ADDR, function () {
        console.log('Server running at http://%s:%d/', ADDR, PORT);
        console.log('Press CTRL+C to exit');
    });

};