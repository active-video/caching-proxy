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
        command: 'node'
        // arguments: 'replay-daemon.js'
    },
    function(err, resultList ) {

        if (err) {
            throw new Error( err );
        }

        var runCount = 0;

        resultList.forEach(function(prcss){

            //console.log( 'PID: %s, COMMAND: %s, ARGUMENTS: %s', prcss.pid, prcss.command, prcss.arguments );

            if (prcss && process.pid != prcss.pid) {

                var isRunningAsDaemon = false;
                // Check if it's running with daemon flag
                for (var x=prcss.arguments.length; x>0; x--) {

                    if (prcss.arguments[x-1] == ARG_DAEMON) {
                        isRunningAsDaemon = true;
                    }
                }

                if (isRunningAsDaemon) {
                    runCount++;
                }

                // if there is another existing instance
                if (runCount > 1) {

                    var hcIsAlive = false;
                    // Health check
                    var hcOptions = {
                        url : 'http://'+ADDR+':'+PORT+'/ping/',
                        method : 'GET',
                        timeout: 5,
                        connectionTimeout : 5
                    };
                    var reqHealthCheck = httpsync.request(hcOptions);
                    reqHealthCheck.end();
                    console.log("statusCode: ", reqHealthCheck.response.statusCode);
                    if (reqHealthCheck.response.statusCode==200) {

                        if (reqHealthCheck.response.data == 'pong') {
                            hcIsAlive = true;
                        }

                    }

                    if (hcIsAlive) {
                        throw new Error("replay-daemon is already running!");
                    } else {

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
        res.writeHead(200, {'Content-Type': 'text/plain'});
        res.end('Hello World\n');
    });

    server.listen(PORT, ADDR, function () {
        console.log('Server running at http://%s:%d/', ADDR, PORT);
        console.log('Press CTRL+C to exit');
    });

};