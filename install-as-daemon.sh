#!/bin/bash

#Kill existing service
killall node;
pm2 kill;

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

npm install caching-proxy;

echo '#!/bin/bash' > /var/www/html/caching-proxy/daemon.sh;
printf '\n\n' >> /var/www/html/caching-proxy/daemon.sh;
echo 'cd /var/www/html/caching-proxy/node_modules/caching-proxy' >> /var/www/html/caching-proxy/daemon.sh;
echo 'pm2 start start.js -o pm2_output.log -e pm2_errors.log -- -e token,rand -b 404,500 -d /var/www/html/caching-proxy/data' >> /var/www/html/caching-proxy/daemon.sh;

chmod 777 /var/www/html/caching-proxy/daemon.sh;

echo '/var/www/html/caching-proxy/daemon.sh' >> /etc/rc.local;

#GET DATA
rm -rf /var/www/html/caching-proxy/data;

/var/www/html/caching-proxy/daemon.sh