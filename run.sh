
docker run -i --rm --cap-add=SYS_ADMIN \
   -v $PWD/output:/output \
   -v $PWD/puppeteer-har.js:/webrenderer/puppeteer-har.js \
   -v $PWD/renderer.js:/webrenderer/renderer.js \
   --name puppeteer-chrome ukwa/webrender-puppeteer \
   node /webrenderer/renderer.js https://www.wikipedia.org/ https://www.bbc.co.uk/news https://twitter.com/MindCharity https://www.britishdeafnews.co.uk/ https://www.unilad.co.uk/
 
