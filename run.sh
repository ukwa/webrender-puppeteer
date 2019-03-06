
docker run -i --rm --cap-add=SYS_ADMIN \
   -v $PWD/output:/output \
   -v $PWD/puppeteer-har.js:/webrenderer/puppeteer-har.js \
   -v $PWD/renderer.js:/webrenderer/renderer.js \
   --name puppeteer-chrome puppeteer-chrome-linux \
   node /webrenderer/renderer.js http://www.unilad.co.uk
