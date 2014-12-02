
var http    = require('http'),
    args    = require('optimist').argv,
    port    = args.p || 8092;

var server = http.createServer(function(req, res){
    setTimeout(function(){
        res.writeHead(200, {'Content-Type': 'text/plain'});
        res.end('pong');
    }, 7000);
});

server.listen(port, '0.0.0.0', function(){
   console.log('Simple Server running, press CTRL + C to exit.');
});
