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

npm install caching-proxy;

echo '#!/bin/bash' > /var/www/html/caching-proxy/daemon.sh;
echo '\n\n' >> /var/www/html/caching-proxy/daemon.sh;
echo 'cd /var/www/html/caching-proxy/node_modules/caching-proxy' >> /var/www/html/caching-proxy/daemon.sh;
echo 'nohup ./daemon.sh -e token,rand -d /var/www/html/caching-proxy/data &' >> /var/www/html/caching-proxy/daemon.sh;

chmod 777 /var/www/html/caching-proxy/daemon.sh;

echo '/var/www/html/caching-proxy/daemon.sh' >> /etc/rc.local;

#GET DATA
rm -rf /var/www/html/caching-proxy/data;

/var/www/html/caching-proxy/daemon.sh