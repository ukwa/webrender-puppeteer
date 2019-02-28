// 'use strict' not required for modules?;

const puppeteer = require('puppeteer');
const PuppeteerHar = require('puppeteer-har');
const devices = require('puppeteer/DeviceDescriptors');
const fs = require('fs');
const { promisify } = require('util');

console.log();

// const url = 'http://data.webarchive.org.uk/crawl-test-site/documents/2018/12/10/broken-links.html';
// const url = 'http://acid.matkelly.com/';
// const url = 'https://www.gov.uk/';
const url = 'https://www.gov.uk/government/publications?departments[]=department-of-health-and-social-care';

(async () => {

  // Set up the browser in the required configuration:
  const browserArgs = {
    args: ['--disk-cache-size=0'],
  };
  // Add proxy configuration if supplied:
  if (process.env.HTTP_PROXY) {
    browserArgs.args.push('--proxy-server=' + process.env.HTTP_PROXY);
  }
  const browser = await puppeteer.launch(browserArgs);
  const page = await browser.newPage();

  // Record requests/responses in a standard format:
  const har = new PuppeteerHar(page);
  await har.start({ path: '/output/results.har' });

  if (false) {
    await page.emulate(devices['iPhone 6']);
  }
  // Go the the page to capture:
  // See https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagegotourl-options for definitions of networkidle0/2
  await page.goto(url, { waitUntil: 'networkidle0' });
  // Give a little extra time for rendering to finish
  // (this is not necessary if we can use networkidle0):
  // await page.waitFor(1000);

  // Render the result:
  await page.screenshot({ path: '/output/rendered.png' });
  await page.screenshot({ path: '/output/rendered-full.png', fullPage: true });
  await page.pdf({
    path: '/output/rendered-page.pdf',
    format: 'a4',
  });
  const html = await page.content();
  await promisify(fs.writeFile)('/output/rendered.html', html);

  // A place to record URLs of different kinds:
  const urls = {};
  // Get the main frame URL:
  urls.url = await page.url()
  // Also get hold of the transcluded resources that make up the page:
  // (this works like capturing page.on('response') events but excludes the URL of the page itself.)
  urls.E = await page.evaluate(() => (
    performance.getEntries()
      .filter(e => e.entryType === 'resource')
      .map(e => e.name)
  ));
  // Get hold of the navigation links:
  urls.L = await page.$$eval('a', as => as.map(a => a.href));
  urls.L = [...new Set(urls.L)];

  // Get the location of clickable <a> elements:
  urls.map = await page.evaluate(() => {
    const clickables = [];
    const elements = Array.prototype.slice.call(document.getElementsByTagName('*'));
    elements.forEach((element) => {
      if (element.offsetParent != null) {
        if (element.onclick != null || element.href !== undefined) {
          const c = {};
          const {
            x, y, width, height,
          } = element.getBoundingClientRect();
          c.location = {
            left: x, top: y, width, height,
          };
          if (element.attributes.href !== undefined) {
            // Get absolute URL:
            c.href = element.href;
          }
          if (element.onclick != null) {
            c.onclick = element.onclick.toString();
          }
          clickables.push(c);
        }
      }
    });
    return clickables;
  });
  await promisify(fs.writeFile)('/output/rendered.urls.json', JSON.stringify(urls));

  // Shut down:
  await har.stop();
  await browser.close();
})();
