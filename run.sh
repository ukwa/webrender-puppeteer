#!/bin/sh
docker run -i --rm --cap-add=SYS_ADMIN \
   -v $PWD/output:/output \
   -v $PWD/puppeteer-har.js:/webrenderer/puppeteer-har.js \
   -v $PWD/renderer.js:/webrenderer/renderer.js \
   -e HTTPS_PROXY=${HTTPS_PROXY} \
   -e HTTP_PROXY=${HTTP_PROXY} \
   -e WARCPROX_WARC_PREFIX=WARC-PREFIX \
   --name puppeteer-chrome ukwa/webrender-puppeteer \
   node /webrenderer/renderer.js $1
 
