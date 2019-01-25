#bin/bash!


# without parent proxy
pm2 start start.js -o pm2_output.log -e pm2_errors.log -- -e token,rand -b 404,500 -d /var/www/html/caching-proxy/data

# with parent proxy
# pm2 start start.js -o pm2_output.log -e pm2_errors.log -- -e token,rand -b 404,500 -d /var/www/html/caching-proxy/data --proxyHost 172.19.241.101 --proxyPort 3128
