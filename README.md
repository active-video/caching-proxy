node-replay-server
==================

A simple replay server useable in your front-end projects to cache API requests and rewrite their responses as needed to be routed through server


## Run as Forever script

First, make `forever.js` executable:

``` bash
  chmod u+x forever.js
```

Then run:

```bash
  ./path/to/folder/forever.js replay-server.js -10 -t 5
```
