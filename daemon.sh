#bin/bash!

pm2 start start.js -o pm2_output.log -e pm2_errors.log -- -e token,rand -b 404,500 -d /var/www/html/caching-proxy/data
