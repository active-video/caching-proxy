caching-proxy
==================

A caching proxy server useable in your front-end projects to cache API requests and rewrite their responses as needed to be routed through server - for trade-shows, demos (offline and online), data that you know will be retired someday and you want a local copy that you can reuse at any time, and load testing in shared environments (example CloudTV where a server could be running thousands of browser sessions at once and you want to test server scalability independent of APIs an app might depend on, ala activevideo.com)

This is NOT an HTTP proxy for your network, it exposes an HTTP service that you can route requests THROUGH (and it caches responses with a TTL = infinity).

### To start up with the default options

```
    # install the caching-proxy
    npm install caching-proxy
    
    # run it
    node start.js
```    
    

### Include in your own project
```
    //package.json
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

## Run as a daemon service

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

* ```i```: health check interval in seconds. How often to ping the caching-proxy server for aliveness. Default is 30 seconds.
* ```t```: health check timeout in seconds. How long to wait for a response from the caching-proxy server before it is considered unresponsive. Default is 10 seconds.
* ```p```: caching-proxy server port. Default is 8092.
* ```d```: the directory to save cached data into, default is the ./data/ folder
* ```e```: <CSV exclusions> a comma separated list of URL parameters to exclude from the hash, for example rand,cache-buster, etc (will still be included in proxied request, just not used when determining if this request matches a previous one)
* ```s```: Expose the status API via /status, default is not to if this flag is omitted. If -s is present, then /status will show all pending request as JSON

#### Example with parameters:

``` 
   bash
  ./path/to/folder/daemon.sh -i 10 -t 5 -p 8093
```

## From your applications that wants to use cached content

All requests routed through caching proxy should have the initial

-  `http://` ---> replaced with `http/`
-  `https://` ---> replaced with `https/`
-  optionally, prefix your URL with a cache folder ID made up of numbers, letters, hyphens and underscores
    -  i.e. http://localhost:8092/my-folder-name/http/www.activevideo.com/

```javascript
   var cachingProxy = 'http://localhost:8092/';
   var urlToGet = 'http://developer.activevideo.com';
   
   var urlRoutedThroughProxy = cachingProxy + urlToGet.replace('http://', 'http/');
   
   var x = new XMLHttpRequest();
   x.open('GET', 'http://localhost:8092/', true);
   x.send();
```

The response will be saved to the directory ./data/default/ by default, or "default" inside the dir you started the proxy with.
 
The response content for any text file will be searched, and all absolute paths within the response text will be replaced with the path to the proxy. 

Note: to use a different folder than "default", the URL should be updated to have a folder ID consisting
of numbers, letters, hyphens and underscores:

```
'http://localhost:8092/load-test-1/http/www.activevideo.com/'
//this will save files to:
'./data/load-test-1/'

````

In this manner it is possible to cache multiple versions of the same resources by providing varying
the caching folder id

Source HTML before proxy does replacements

```
   <html>
        <img src="http://developer.activevideo.com/templates/avdeveloper/images/logo.png" />
   </html>
```

"Massaged" HTML after'
```
   <html>
        <img src="http://localhost:8092/http/developer.activevideo.com/templates/avdeveloper/images/logo.png" />
   </html>
```


# Run via pm2

You can use the process manager `pm2` to run the caching-proxy as a service.

Node package: https://www.npmjs.com/package/pm2

pm2 website: http://pm2.keymetrics.io/

## Install pm2
```
npm install pm2
```

## Run start .js with your parameters
```
pm2 start start.js -o pm2_output.log -e pm2_errors.log -- -e token,rand -b 404,500 -d ./data
```

## List out pm2 apps
```
pm2 list
```

## Monitor pm2 apps
```
pm2 monit
```