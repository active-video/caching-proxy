node-replay-server
==================

A simple replay server usable in your front-end projects to cache API requests and rewrite their responses as needed to be routed through server


## Run as Forever script

### First, make `forever.js` executable:

``` bash
  chmod u+x forever.js
```

### Then run:

``` bash
  ./path/to/folder/forever.js replay-server.js
```

### Available parameters:

* ```i```: health check interval in seconds. How often to ping the node-replay server for aliveness. Default is 30 seconds.
* ```t```: health check timeout in seconds. How long to wait for a response from the node-replay server before it is considered unresponsive. Default is 10 seconds.
* ```p```: node-replay server port. Default is 8092.

#### Example with parameters:

``` bash
  ./path/to/folder/forever.js replay-server.js -i 10 -t 5 -p 8093
```
