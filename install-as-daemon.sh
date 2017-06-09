#!/bin/bash

#Kill existing service
killall node;

#Create the folder structure and download the service
cd /var/www/html/;
rm -rf caching-proxy;
mkdir caching-proxy;
cd caching-proxy;
mkdir data;
chmod 777 data;

yum install -y nodejs;
yum update nodejs;
npm update nodejs;

sudo npm cache clean -f
sudo npm install -g n
sudo n stable;

# Install PM2 and kill existing pm2 processes if any
sudo npm install -g pm2
pm2 kill

npm install caching-proxy;

echo '#!/bin/bash' > /var/www/html/caching-proxy/daemon.sh;
printf '\n\n' >> /var/www/html/caching-proxy/daemon.sh;
echo 'cd /var/www/html/caching-proxy/node_modules/caching-proxy' >> /var/www/html/caching-proxy/daemon.sh;
echo 'pm2 start start.js -o pm2_output.log -e pm2_errors.log -- -e token,rand -b 404,500 -d /var/www/html/caching-proxy/data' >> /var/www/html/caching-proxy/daemon.sh;

chmod 777 /var/www/html/caching-proxy/daemon.sh;

echo '/var/www/html/caching-proxy/daemon.sh' >> /etc/rc.local;

/var/www/html/caching-proxy/daemon.sh

pm2 list
