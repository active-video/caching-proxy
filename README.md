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
  ./path/to/folder/daemon.sh
```

### Available parameters:

* ```i```: health check interval in seconds. How often to ping the node-replay server for aliveness. Default is 30 seconds.
* ```t```: health check timeout in seconds. How long to wait for a response from the node-replay server before it is considered unresponsive. Default is 10 seconds.
* ```p```: node-replay server port. Default is 8092.

#### Example with parameters:

``` bash
  ./path/to/folder/forever.js replay-server.js -i 10 -t 5 -p 8093
```

### Include in your own project
```//package.json
    dependencies: {
    ...
    "caching-proxy":"^1.0.0"
    ...
    }
```

#### Then where you need it to start inline
```//auto-start the server right away
    require('caching-proxy').start()
```

### #Or to use it in your script
```//use it
    var CachingProxy=require('caching-proxy')
    
    var proxy = new CachingProxy({
        port: 9090, 
        dir: './data/cached-data'
    })
```