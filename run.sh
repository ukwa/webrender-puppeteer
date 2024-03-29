#!/bin/sh
docker run -i --rm --cap-add=SYS_ADMIN \
   -v $PWD/output:/output \
   -v $PWD/puppeteer-har.js:/webrenderer/puppeteer-har.js \
   -v $PWD/renderer.js:/webrenderer/renderer.js \
   -e HTTPS_PROXY=${HTTPS_PROXY} \
   -e HTTP_PROXY=${HTTP_PROXY} \
   -e WARCPROX_WARC_PREFIX=WARCPROX-PREFIX \
   -e DEVICE_SCALE_FACTOR=1.0 \
   --name puppeteer-chrome ukwa/webrender-puppeteer:2.1.0 \
   node /webrenderer/renderer.js $1
#   --shm-size=1gb \
#   -e SWITCH_DEVICES=true \
 
