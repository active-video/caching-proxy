#bin/bash!

for ((i=0;i<20;i++)); do nohup curl -v "http://0.0.0.0:8092/http/char.tmsimg.com/tvbanners/v7/AllPhotos/183875/p183875_b_v7_aa.jpg?h=2$i" > /dev/null; done