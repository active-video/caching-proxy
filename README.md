node-replay-server
==================

A caching proxy server useable in your front-end projects to cache API requests and rewrite their responses as needed to be routed through server - for tradeshows, demos (offline and online), data that you know will be retired someday and you want a capture in time that you can reuse, and load testing in shared environments (exmample CloudTV where a server could be running thousands of browser sessions at once and you want to test server scalability independent of APIs an app might depend on, ala activevideo.com)

### Include in your own project
```//package.json
    dependencies: {
    ...
    "caching-proxy":"^1.0.0"
    ...
    }
```

#### Then where you need it to start inline
```
    //auto-start the server right away
    require('caching-proxy').start()
```

#### Or to use it in your script
```
    //use it
    var CachingProxy=require('caching-proxy')
    
    var proxy = new CachingProxy({
        port: 9090, 
        dir: './data/cached-data'
    })
```

## Run as a deamon service

### First, make `daemon.sh` executable:

``` bash
  chmod u+x daemon.sh
```

*nix, not Windows compatible. For windows, you will need to write a *.bat file

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
  ./path/to/folder/daemon.sh -i 10 -t 5 -p 8093
```

