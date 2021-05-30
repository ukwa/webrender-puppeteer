/* eslint-disable max-len */
/* eslint-disable no-console */
// 'use strict' not required for modules?;

const puppeteer = require('puppeteer');
const fs = require('fs');
const fsp = require("fs/promises");
const { promisify } = require('util');
const PuppeteerHar = require('./puppeteer-har');

const { devices } = puppeteer;

// const url = 'http://data.webarchive.org.uk/crawl-test-site/documents/2018/12/10/broken-links.html';
// const url = 'http://acid.matkelly.com/';
// const url = 'https://www.gov.uk/';
// const url = 'https://www.gov.uk/government/publications?departments[]=department-of-health-and-social-care';
// const url = 'http://example.org/';

process.on('unhandledRejection', (error, p) => {
  // Will print "unhandledRejection err is not defined"
  console.log('Caught unhandledRejection: ', error.message, p);
  process.exit(1);
});

function headersArray(headers) {
  const result = [];
  Object.entries(headers).forEach(([k, v]) => {
    if (!Object.is(v, undefined)) {
      result.push({ name: k, value: `${v}` });
    }
  });
  return result;
}

/**
 * Captures all traffic including from Web Workers, does something with it, and continues the request
 * @param target The page/tab/worker target to capture from.
 */
const interceptAllTrafficForPageUsingFetch = async (target, extraHeaders) => {
  if (target) {
    const client = await target.createCDPSession();
    // see: https://chromedevtools.github.io/devtools-protocol/tot/Fetch#method-enable
    // In rare cases ( https://covid19ukmap.com/ ) this can crash out, so protect against exceptions:
    try {
      await client.send('Fetch.enable');
      console.log('Sent Fetch.enable.');
    } catch(error) {
      console.log('Exception when sending Fetch.enable: ', error.message);
    }
    // see: https://chromedevtools.github.io/devtools-protocol/tot/Fetch#event-requestPaused
    await client.on('Fetch.requestPaused', async ({
      requestId,
      request,
      // frameId,
      // resourceType,
      // responseErrorReason,
      // responseStatusCode,
      // responseHeaders,
      // networkId
    }) => {
      // console.log(`Intercepting ${request.url}`);
      // Insert additional headers
      Object.entries(extraHeaders).forEach(([k, v]) => {
        request.headers[k] = v;
      });

      try {
        // Continuing the request with the modified header:
        await client.send('Fetch.continueRequest', {
          requestId,
          headers: headersArray(request.headers),
        });
      } catch(error) {
        console.log('Exception when seding Fetch.continueRequest: ', error.message);
      }
    });
  }
}

async function render_page(page, url) {
  // Set up some logging of any errors:
  page.on('error', err=> {
    console.log('error happen at the page: ', err);
  });

  page.on('pageerror', pageerr=> {
    console.log('pageerror occurred: ', pageerr);
  })

  // Options for the render process:
  let switchDevices = false;
  if ('SWITCH_DEVICES' in process.env) {
    switchDevices = process.env.SWITCH_DEVICES;
  }
  console.log(`switchDevices = ${switchDevices}`);

  // Main image width:
  const viewportWidth = parseInt(process.env.VIEWPORT_WIDTH) || 1366;
  const viewportHeight = parseInt(process.env.VIEWPORT_HEIGHT) || Math.round(viewportWidth / 1.6180);
  const deviceScaleFactor = parseFloat(process.env.DEVICE_SCALE_FACTOR) || 1.0;

  // Set the page size:
  await page.setViewport({ width: viewportWidth, height: viewportHeight, deviceScaleFactor: deviceScaleFactor });

  // Avoid caching:
  await page.setCacheEnabled(false);

  // Set the default timeout:
  await page.setDefaultNavigationTimeout(60000); // 60 seconds instead of 30

  // Set the user agent up:
  // Add optional userAgent override:
  if ('USER_AGENT' in process.env) {
    page.setUserAgent(process.env.USER_AGENT);
    // e.g. 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) \
    // Chrome/37.0.2062.120 Safari/537.36';
  } else if ('USER_AGENT_ADDITIONAL' in process.env) {
    const userAgent = await browser.userAgent();
    page.setUserAgent(`${userAgent} ${process.env.USER_AGENT_ADDITIONAL}`);
  }

  // Record requests/responses in a standard format:
  const har = new PuppeteerHar(page);
  await har.start();

  // Go the the page to capture:
  // See https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagegotourl-options for definitions of networkidle0/2
  console.log(`Navigating to ${url}...`);
  try {
    // Main navigation
    await page.goto(url, { waitUntil: 'networkidle2' }); // Longer timeout set above
    console.log(`${url} - Waiting for delayed popups...`);
    await page.waitForTimeout(2000);

    // Look for any "I Accept" buttons
    console.log(`${url} - Looking for any modal buttons...`);
    await clickKnownModals(page);

    // Await for any more elements scrolling down prompted:
    console.log(`${url} - Waiting for any activity to die down...`);
    // Usinf networkidle0 will usually hang as this event has already passed.
    // await page.waitForNavigation({ waitUntil: 'networkidle0' });
    await page.waitForTimeout(4000);

    // Now scroll down:
    console.log(`${url} - Scrolling down...`);
    await autoScroll(page);
  
    // Await for any more elements scrolling down prompted:
    console.log(`${url} - Waiting for any activity to die down...`);
    await page.waitForTimeout(6000);

  } catch (e) {
    console.error('We got an error, but lets continue and render what we get.\n', e);
  }

  // Render the result:
  console.log(`${url} - Rendering full page...`);
  // Full page:
  const image = await page.screenshot({ fullPage: true });
  //const image = await page.screenshot({ path: `${outPrefix}rendered-full.png`, fullPage: true });

  // A place to record URLs of different kinds:
  const urls = {};
  // Get the main frame URL:
  urls.url = await page.url();
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

  // Scroll back to the top and take the viewport screenshot:
  console.log(`${url} - Scrolling back to top...`);
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
  });

  // Await for any further activity following the scroll back:
  console.log(`${url} - Waiting for any activity to die down...`);
  await page.waitForTimeout(1000);

  // Viewport only:
  console.log(`${url} - Rendering viewport...`);
  const screenshot = await page.screenshot({ type: 'jpeg', quality: 100 });

  // Print to PDF but use the screen CSS:
  console.log(`${url} - Rendering PDF...`);
  await page.emulateMediaType('screen');
  const pdf = await page.pdf({
    //path: `${outPrefix}rendered-page.pdf`,
    format: 'A4',
    scale: 0.75,
    printBackground: true,
  });
  const html = await page.content();
  //await promisify(fs.writeFile)(`${outPrefix}rendered.html`, html);

  // After rendering main view, attempt to switch between devices to grab alternative media
  if (switchDevices) {
    // TODO Debug why this is reaaallly sloooow on some sites,
    // e.g. www.wired.co.uk, where it also over-crawls.
    try {
      // Switch to different user agent settings to attempt to ensure additional media downloaded:
      console.log(`${url} - Switching device settings...`);
      await page.emulate(devices['iPhone 6']);
      await page.emulate(devices['iPhone X landscape']);
      await page.emulate(devices['Nexus 6']);

      // Switch through a few widths to encourage JS-based responsive image loading:
      await page.setViewport({
        width: 480, height: 1024, deviceScaleFactor: 1, isMobile: false, hasTouch: false, isLandscape: false,
      });
      await page.setViewport({
        width: 640, height: 1024, deviceScaleFactor: 1, isMobile: false, hasTouch: false, isLandscape: false,
      });
      await page.setViewport({
        width: 800, height: 1024, deviceScaleFactor: 1, isMobile: false, hasTouch: false, isLandscape: false,
      });
      await page.setViewport({
        width: 1024, height: 1024, deviceScaleFactor: 1, isMobile: false, hasTouch: false, isLandscape: false,
      });

      // Switch back to the standard device view:
      await page.setViewport({
        width: viewportWidth, height: 1024, deviceScaleFactor: 1, isMobile: false, hasTouch: false, isLandscape: false,
      });

      // Await for any more elements the device switching prompted:
      console.log(`${url} - Waiting for any activity to die down...`);
      await page.waitForTimeout(2000);
    } catch (e) {
      console.error(`${url} - We got an error, but lets continue and render what we get.\n`, e);
    }
  }

  // Get all the transcluded resources that make up the page:
  // (this works like capturing page.on('response') events but excludes the URL of the page itself.)
  urls.E = await page.evaluate(() => (
    performance.getEntries()
      .filter(e => e.entryType === 'resource')
      .map(e => e.name)
  ));

  // Assemble the results:
  const harStandard = await har.stop();
  // Read in the package JSON to get the version:
  const packageFileJSON = JSON.parse(await fsp.readFile("package.json"));
  //
  const harExtended = {
    'software': `webrender-puppeteer ${packageFileJSON["version"]}`,
    'har': harStandard,
    'urls': urls,
    'cookies': await page.cookies(),
  };
  // And store the final/rendered forms:
  const b64Content = Buffer.from(html).toString('base64');
  harExtended.finalPage = {
    content: b64Content,
    encoding: 'base64',
    contentType: 'text/html',
  };

  // TBA The full page with image map:
  //harExtended.finalImageMap

  // The viewport:
  harExtended.renderedViewport = {
    content: Buffer.from(screenshot).toString('base64'),
    encoding: 'base64',
    contentType: 'image/jpeg',
  };
  // The full page as image and PDF:
  const b64Image = Buffer.from(image).toString('base64');
  const b64Pdf = Buffer.from(pdf).toString('base64');
  harExtended.renderedElements = [{
    selector: ':root',
    contentType: 'image/png',
    content: b64Image,
    encoding: 'base64',
  }, {
    selector: ':root',
    contentType: 'application/pdf',
    content: b64Pdf,
    encoding: 'base64',
  }];

  console.log(`${url} - Complete.`);
  return harExtended;
}

async function render(url) {
  // Set up any specified custom headers:
  const extraHeaders = {};
  // Add Memento Datetime header if needed:
  // e.g. Accept-Datetime: Thu, 31 May 2007 20:35:00 GMT
  if ('MEMENTO_ACCEPT_DATETIME' in process.env) {
    extraHeaders['Accept-Datetime'] = process.env.MEMENTO_ACCEPT_DATETIME;
  }
  // Add a warc-prefix as JSON in a Warcprox-Meta: header
  if ('WARCPROX_WARC_PREFIX' in process.env) {
    extraHeaders['Warcprox-Meta'] = `{ "warc-prefix": "${process.env.WARCPROX_WARC_PREFIX}" }`;
  }

  // Set up the browser in the required configuration:
  const browserArgs = {
    ignoreHTTPSErrors: true,
    args: [
      '--disk-cache-size=0',
      '--no-sandbox',
      '--ignore-certificate-errors',
      '--disable-dev-shm-usage',
      "--no-xshm", // needed for Chrome >80 (check if puppeteer adds automatically)
      "--disable-background-media-suspend",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-popup-blocking",
      "--disable-backgrounding-occluded-windows",
    ],
  };
  // Add proxy configuration if supplied:
  if (process.env.HTTP_PROXY) {
    proxy_url = process.env.HTTP_PROXY;
    // Remove any trailing slash:
    proxy_url = proxy_url.replace(/\/$/,'')
    browserArgs.args.push(`--proxy-server=${proxy_url}`);
  }
  console.log('Browser arguments: ', browserArgs);
  const browser = await puppeteer.launch(browserArgs);

  // Add hook to track activity and modify headers in all contexts (pages, workers, etc.):
  browser.on('targetcreated', async (target) => {
    await interceptAllTrafficForPageUsingFetch(target, extraHeaders);
  });

  // Set up a clean 'incognito' context and page:
  const context = await browser.createIncognitoBrowserContext();
  const page = await context.newPage();

  // Run the page-level rendering process:
  harExtended = render_page(page, url);

  // Output prefix:
  let outPrefix = '/output/';
  if ('OUTPUT_PREFIX' in process.env) {
    outPrefix = process.env.OUTPUT_PREFIX;
  }
  console.log(`outPrefix = ${outPrefix}`);

  // Write out the extended HAR:
  await promisify(fs.writeFile)(`${outPrefix}rendered.har`, JSON.stringify(harExtended));

  // Shut down:
  console.log('Shutting down...');
  await browser.close();

  // And return the result too:
  return harExtended;
}

// Automatically scroll down:
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = window.innerHeight;
      const timer = setInterval(() => {
        const { scrollHeight } = document.body;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight || totalHeight > 4000) {
          clearInterval(timer);
          resolve();
        }
      }, 1000);
    });
  });
}

async function clickButton(page, buttonText) {
  await page.evaluate((query) => {
    const elements = [...document.querySelectorAll('button')];

    // Either use .find or .filter, comment one of these
    // find element with find
    const targetElement = elements.find(e => e.innerText.toLowerCase().includes(query));

    // To do? Also check aria-label="Close" style buttons?

    // OR, find element with filter
    // const targetElement = elements.filter(e => e.innerText.includes(query))[0];

    // make sure the element exists, and only then click it
    if (targetElement) {
      targetElement.click();
    }
  }, buttonText.toLowerCase());
}

async function clickKnownModals(page) {
  try {
    // Press escape for transient popups:
    await page.keyboard.press('Escape');

    // Click close on a class of popup observer at https://www.britishdeafnews.co.uk/
    // Doesn't seem to work!
    await page.evaluate(async () => {
      const elements = [...document.querySelectorAll('a.ppsPopupClose')];
      const targetElement = elements[0];
      // make sure the element exists, and only then click it
      if (targetElement) {
        targetElement.click();
      }
    });

    // Click known common modals (doing these last as some lead to navigation events):
    await clickButton(page, 'I Accept');
    await clickButton(page, 'I Understand');
    await clickButton(page, 'Accept Recommended Settings');
    await clickButton(page, 'Close');
    await clickButton(page, 'OK');
    await clickButton(page, 'I Agree');
    await clickButton(page, 'AGREE');
    await clickButton(page, 'Allow all');

  } catch (e) {
    console.error('A page.evaluate failed, perhaps due to a navigation event.\n', e);
  }
}

module.exports = {
  render_page,
  render
}
