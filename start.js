/**
 * And alias to fire up an instance of a caching-proxy if running
 * as a stand alone script, make sure to include the launch parameters
 *
 * -d running as a daemon, this is more for introspection, pass this in if you are firing us up as a daemon
 * -p <port number> the port to run on, the default is 8092
 */

require("./lib/caching-proxy").start();