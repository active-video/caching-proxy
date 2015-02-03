/**
 * And alias to fire up an instance of a caching-proxy if running
 * as a stand alone script, make sure to include the launch parameters
 *
 * -d running as a daemon, this is more for introspection, pass this in if you are firing us up as a daemon
 * -p <port number> the port to run on, the default is 8092
 * -e <CSV exclusions> a comma separated list of URL parameters to exclude from the hash, for example rand,cache-buster, etc (will still be included in proxied request, just not used when determining if this request matches a previous one)
 * -s Expose the status API via /status, default is not to if this flag is omitted. If -s is present, then /status will show all pending request as JSON
 */

require("./lib/caching-proxy").start();