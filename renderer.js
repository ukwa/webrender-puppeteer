/* eslint-disable max-len */
/* eslint-disable no-console */
// 'use strict' not required for modules?;

const puppeteer = require('puppeteer');
const fs = require('fs');
const fsp = require("fs/promises");
const temp = require('temp')
const { finished } = require('stream/promises');
const { promisify } = require('util');
const PuppeteerHar = require('./puppeteer-har');
//const WARCWriter = require('./warcwriter');
const WARCPoster = require('./warcPoster.js');

// Read in the package JSON to get the version:
const packageFileJSON = JSON.parse(fs.readFileSync("package.json"));
const packageVersion = packageFileJSON["version"];
const softwareId = `ukwa/webrender-puppeteer:${packageVersion}`;

// Set up WARC writing:
//const WARC_OUTPUT_PATH = process.env.WARC_OUTPUT_PATH || '.';
//const WARC_PREFIX = process.env.WARC_PREFIX || 'WEBRENDERED';
//const WARC_INFO = { 'software': softwareId };
//const ww = new WARCWriter(WARC_OUTPUT_PATH, WARC_PREFIX, WARC_INFO);
const ww = new WARCPoster();

// Get device list from Puppeteer:
const { devices } = puppeteer;

// Log any unexpected errors (rather than crashing out):
process.on('unhandledRejection', (error, p) => {
  // Will print "unhandledRejection err is not defined"
  console.log('Caught unhandledRejection: ', error.message, p);
  process.exit(1);
});

// Helper to make headers into an array:
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
      console.log(`Sent Fetch.enable, extraHeaders = ${JSON.stringify(extraHeaders)}`);
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
        console.log('Exception when sending Fetch.continueRequest: ', error.message);
      }
    });
  }
}

async function render_page(page, url, extraHeaders, warcPrefix=null) {
  console.log("render_page got warcPrefix: " + warcPrefix );

  // Add hook to track activity and modify headers in all contexts (pages, workers, etc.):
  // Note that extraHTTPHeaders means the browser sends headers like:
  //   Access-Control-Request-Headers: warcprox-meta
  // which warcprox doesn't block, and confuses the heck out of e.g. Twitter.
  const interceptor = async (target) => {
    await interceptAllTrafficForPageUsingFetch(target, extraHeaders);
  };
  await interceptor(await page.target());
  await page.browser().on('targetcreated', interceptor );
  console.log(`Set up interception for ${url} and extraHeaders ${JSON.stringify(extraHeaders)}.`);


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
    switchDevices = (process.env.SWITCH_DEVICES.toLowerCase().trim() === 'true');
  }
  console.log(`switchDevices = ${switchDevices}`);
  let runBehaviours = true;
  if ('RUN_BEHAVIOURS' in process.env) {
    runBehaviours = (process.env.RUN_BEHAVIOURS.toLowerCase().trim() === 'true');
  }
  console.log(`runBehaviours = ${runBehaviours}`);

  // Main image width:
  const viewportWidth = parseInt(process.env.VIEWPORT_WIDTH) || 1366;
  const viewportHeight = parseInt(process.env.VIEWPORT_HEIGHT) || Math.round(viewportWidth * 1.6180);
  const deviceScaleFactor = parseFloat(process.env.DEVICE_SCALE_FACTOR) || 1.0;

  // Set the page size:
  await page.setViewport({ width: viewportWidth, height: viewportHeight, deviceScaleFactor: deviceScaleFactor });

  // Avoid caching:
  await page.setCacheEnabled(false);

  // Set the default timeout:
  await page.setDefaultNavigationTimeout(60000); // 60 seconds instead of 30

  // Set the user agent up:
  const browserUserAgent = await page.browser().userAgent();
  console.log("Default User-Agent: " + browserUserAgent );
  // Add optional userAgent override:
  if ('USER_AGENT' in process.env) {
    console.log("Setting User-Agent: " + process.env.USER_AGENT.replace('@VERSION@', packageVersion));
    page.setUserAgent(process.env.USER_AGENT.replace('@VERSION@', packageVersion));
    // e.g. 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) \
    // Chrome/37.0.2062.120 Safari/537.36';
  } else if ('USER_AGENT_ADDITIONAL' in process.env) {
    const userAgent = `${browserUserAgent} ${process.env.USER_AGENT_ADDITIONAL}`.replace('@VERSION@', packageVersion);
    console.log("Setting User-Agent: " + userAgent);
    page.setUserAgent(userAgent);
  }

 // await page.setUserAgent('Chrome/91.0.4469.0');
 // await page.setUserAgent('Chrome/88.0.4298.0');

  // Record requests/responses in a standard format:
  const har = new PuppeteerHar(page);
  await har.start();

  // Go the the page to capture:
  // See https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagegotourl-options for definitions of networkidle0/2
  console.log(`Navigating to ${url}...`);
  try {
    // Main navigation
    await page.goto(url, { waitUntil: 'networkidle2' }); // Longer timeout set above

    // Run behaviour scripts like scrollers:
    if ( runBehaviours ) {
      console.log(`${url} - Waiting for delayed popups...`);
      await page.waitForTimeout(2*1000);

      // Look for any "I Accept" buttons
      console.log(`${url} - Looking for any modal buttons...`);
      await clickKnownModals(page);

      // Await for any more elements scrolling down prompted:
      console.log(`${url} - Waiting for any activity to die down...`);
      // Using networkidle0 will usually hang as this event has already passed.
      // await page.waitForNavigation({ waitUntil: 'networkidle0' });
      //await page.waitForNetworkIdle({timeout: 4000});
      waitForNetworkIdle(page,4000);
      await page.waitForTimeout(2*1000);

      // Now scroll down:
      console.log(`${url} - Scrolling down...`);
      await autoScroll(page);
      console.log(`${url} - Scrolling back to the top...`);
      await page.evaluate('window.scrollTo(0,0)');
    }
 
    // Set viewport to cover whole body:
    const bodyHandle = await page.$('body');
    var { width, height } = await bodyHandle.boundingBox();
    height = Math.floor(height);
    // Don't set it very large (things get bugger >16k):
    if( height > 10000 ) {
      height = 10000;
    }
    if( height > viewportHeight) {
      console.log("Setting viewport: "+ viewportWidth + "x" + height);
      await page.setViewport({width: viewportWidth, height: height});
    }
    // Await for any more elements scrolling down prompted:
    console.log(`${url} - Waiting for any activity to die down...`);
    //await page.waitForNetworkIdle({timeout: 4000});
    waitForNetworkIdle(page,4000);

  } catch (e) {
    console.error('We got an error, but lets continue and render what we get.\n', e);
  }

  // Render the result:
  console.log(`${url} - Rendering web page as PNG...`);
  // Full page:
  const image = await page.screenshot({ fullPage: true });

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

  // And the HTML:
  const html = await page.content();

  // Additional items to generate, if writing to WARC:
  if ( ww.isEnabled() ) {
    // Also get a JPEG for the imagemap:
    console.log(`${url} - Rendering screenshot as JPEG...`);
    var imageJpeg = await page.screenshot({ type: 'jpeg', quality: 100, fullPage: true });

    // Print to PDF but use the screen CSS:
    console.log(`${url} - Rendering PDF...`);
    await page.emulateMediaType('screen');
    // Uses streaming mode to reduce RAM usage:
    var pdf = await page.createPDFStream({
      format: 'A4',
      scale: 0.75,
      printBackground: true,
      timeout: 20*1000, // Use a shortish timeout as this can be flaky.
    });
  }

  // After rendering main view, attempt to switch between devices to grab alternative media
  if (switchDevices) {
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

  // Override creator info:
  harStandard['log']['creator'] = {
    'name': 'webrender-puppeteer',
    'version': packageVersion,
    'comment': 'https://github.com/ukwa/webrender-puppeteer'
  }
  // And write to WARC (even if there was no 'page' -- see below):
  if ( ww.isEnabled() ) {
    const finalUrl = urls.url;
    await ww.writeRenderedImageFromBuffer(warcPrefix, `har:${url}`, finalUrl, 'application/json', new TextEncoder().encode(JSON.stringify(harStandard)));

    // Check if there were any pages (there are none for e.g. PDFs):
    if( harStandard['log']['pages'].length > 0 ) {
      // Store HTML and PNG in WARCs:
      await ww.writeRenderedImageFromBuffer(warcPrefix, `onreadydom:${url}`, finalUrl, 'text/html', new TextEncoder().encode(html));
      await ww.writeRenderedImageFromBuffer(warcPrefix, `screenshot:${url}`, finalUrl, 'image/png', image);

      // Store the PDF:
      var fsStream = temp.createWriteStream();
      console.log("GOT temp path: " + fsStream.path);
      pdf.pipe(fsStream);
      await finished(fsStream);
      console.log("PIPED to temp path: " + fsStream.path);
      var stats = fs.statSync(fsStream.path);
      pdfContentLength = stats.size;
      pdf = fs.createReadStream(fsStream.path);
      console.log("Opening Readable Stream " + fsStream.path);
      await ww.writeRenderedImage(warcPrefix, `pdf:${url}`, finalUrl, 'application/pdf', pdf, pdfContentLength);
      console.log("Deleting temp file: " + fsStream.path);
      await finished(pdf);
      fs.rmSync(fsStream.path);

      // Store the full page with image map:
      const title = harStandard['log']['pages'][0]['title'];
      const imageMapHtml = _toImageMap(url, title, imageJpeg, urls.map);
      await ww.writeRenderedImageFromBuffer(warcPrefix, `imagemap:${url}`, finalUrl, 'text/html', new TextEncoder().encode(imageMapHtml));
    }
  } else {
    console.log("WARC writing skipped.")
  }

  // Build extended/wrapper HAR:
  const harExtended = {
    'software': softwareId,
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
  const b64Viewport = Buffer.from(image).toString('base64');
  harExtended.renderedViewport = {
    content: b64Viewport,
    encoding: 'base64',
    contentType: 'image/png',
  };

  // Clean out the event listeners:
  await page.browser().removeListener('targetcreated', interceptor);

  console.log(`${url} - Complete.`);
  return harExtended;
}

// HTML5: https://dev.w3.org/html5/spec-preview/image-maps.html
// <img src="shapes.png" usemap="#shapes"
//      alt="Four shapes are available: a red hollow box, a green circle, a blue triangle, and a yellow four-pointed star.">
// <map name="shapes">
//  <area shape=rect coords="50,50,100,100"> <!-- the hole in the red box -->
//  <area shape=rect coords="25,25,125,125" href="red.html" alt="Red box.">
//  <area shape=circle coords="200,75,50" href="green.html" alt="Green circle.">
//  <area shape=poly coords="325,25,262,125,388,125" href="blue.html" alt="Blue triangle.">
//  <area shape=poly coords="450,25,435,60,400,75,435,90,450,125,465,90,500,75,465,60"
//        href="yellow.html" alt="Yellow star.">
// </map>
// <img alt="Embedded Image" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIA..." />
function _toImageMap(url, title, imageJpeg, map) {
    html = `<html><head><title>${title} [Static version of ${url}]</title>\n</head>\n<body style="margin: 0;">\n`
    const buf = Buffer.from(imageJpeg);
    html = html + `<img src="data:image/jpeg;base64,${buf.toString('base64')}" usemap="#shapes" alt="${title}">\n`
    html = html + '<map name="shapes">\n'
    for (box of map) {
      if('href' in box) {
          x1 = box['location']['left']
          y1 = box['location']['top']
          x2 = x1 + box['location']['width']
          y2 = y1 + box['location']['height']
          html = html + `<area shape=rect coords="${x1},${y1},${x2},${y2}" href="${box['href']}">\n`
      } else {
          console.log("_toImageMap: Skipping box with no 'href': %s" % box)
      }
    }
    html = html + '</map>\n'
    html = html + "</body>\n</html>\n"
    return html
}


async function render(url) {
  // Set up the browser in the required configuration:
  const browserArgs = {
    ignoreHTTPSErrors: true,
    args: [
      '--disk-cache-size=0',
      '--no-sandbox',
      '--ignore-certificate-errors',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      "--no-xshm", // needed for Chrome >80 (check if puppeteer adds automatically)
      "--disable-background-media-suspend",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-popup-blocking",
      "--disable-backgrounding-occluded-windows"
    ],
  };
  // Add proxy configuration if supplied:
  if (process.env.HTTP_PROXY) {
    proxy_url = process.env.HTTP_PROXY;
    // Remove any trailing slash:
    proxy_url = proxy_url.replace(/\/$/,'');
    browserArgs.args.unshift(`--proxy-server=${proxy_url}`);
  }
  console.log('Browser arguments: ', browserArgs);
  const browser = await puppeteer.launch(browserArgs);

  // Set up a clean 'incognito' context and page:
  const context = await browser.createIncognitoBrowserContext();
  const page = await context.newPage();

  // Run the page-level rendering process:
  harExtended = render_page(page, url, extraHeaders, null);

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
      const distance = Math.floor(window.innerHeight/2);
      const timer = setInterval(() => {
        const { scrollHeight } = document.body;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight || totalHeight > 8000) {
          clearInterval(timer);
          resolve();
        }
      }, 1000);
    });
  });
}

async function clickButton2(page, buttonText) {
  // Set up matcher logic
  clickMatchingButtons = (query) => {
    const elements = [...document.querySelectorAll('button')];

    // Find elements with filter
    const targetElements = elements.filter(e => e.innerText.toLowerCase().includes(query.toLowerCase()));
  
    // make sure the element exists, and only then click it
    if (targetElements) {
      targetElements.forEach((targetElement) => {
        targetElement.click();
      });
    }
    
  }
  
  // Find all buttons in all frames:
  //await page.evaluate(clickMatchingButtons, buttonText);
  await page.frames().forEach( async (frame) => {
    await frame.evaluate(clickMatchingButtons, buttonText);
  });
}

/**
 * This seems to reliably deal with the HuffPo UK cookie banner, where the above (which should be the same) does not.
 * @param {*} page 
 * @param {*} buttonText 
 */
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
  // And scan frames:
  // This was created for the Guardian, but only seems to half work.
  // The page is visible, but the images are grey boxes. Not clear why.
  //await clickButton2(page, buttonText);
}

/**
 * 
 * @param {*} page 
 */
async function clickKnownModals(page) {
  try {
    // Press escape for transient popups:
    await page.keyboard.press('Escape');

    // Click close on a class of popup observer at https://www.britishdeafnews.co.uk/
    // Doesn't seem to work!
    await page.evaluate( () => {
      const elements = [...document.querySelectorAll('a.ppsPopupClose')];
      const targetElement = elements[0];
      // make sure the element exists, and only then click it
      if (targetElement) {
        targetElement.click();
      }
    });

    // Click known common modals (doing these last as some lead to navigation events):
    await clickButton(page, 'Yes, I’m happy'); // Guardian UK
    await clickButton(page, 'I Accept');
    await clickButton(page, 'I Understand');
    await clickButton(page, 'Accept Recommended Settings');
    await clickButton(page, 'OK');
    await clickButton(page, 'I Agree');
    await clickButton(page, 'AGREE & EXIT');
    await clickButton(page, 'Allow all');
    await clickButton(page, 'Close');

  } catch (e) {
    console.error('A page.evaluate failed, perhaps due to a navigation event.\n', e);
  }
}

// From https://stackoverflow.com/questions/54377650/how-can-i-wait-for-network-idle-after-click-on-an-element-in-puppeteer
// Hack to cope with lack of this function in this version of Puppteer (<10.4.0):
function waitForNetworkIdle(page, timeout, maxInflightRequests = 0) {
  page.on('request', onRequestStarted);
  page.on('requestfinished', onRequestFinished);
  page.on('requestfailed', onRequestFinished);

  let inflight = 0;
  let fulfill;
  let promise = new Promise(x => fulfill = x);
  let timeoutId = setTimeout(onTimeoutDone, timeout);
  return promise;

  function onTimeoutDone() {
    page.removeListener('request', onRequestStarted);
    page.removeListener('requestfinished', onRequestFinished);
    page.removeListener('requestfailed', onRequestFinished);
    fulfill();
  }

  function onRequestStarted() {
    ++inflight;
    if (inflight > maxInflightRequests)
      clearTimeout(timeoutId);
  }

  function onRequestFinished() {
    if (inflight === 0)
      return;
    --inflight;
    if (inflight === maxInflightRequests)
      timeoutId = setTimeout(onTimeoutDone, timeout);
  }
}


module.exports = {
  render_page,
  render
}
