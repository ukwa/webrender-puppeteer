
docker run -i --rm --cap-add=SYS_ADMIN \
   -v $PWD/output:/output \
   --name puppeteer-chrome puppeteer-chrome-linux \
   node -e "`cat renderer.js`"
