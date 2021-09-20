const app = require("express")();

const e = require("express");
const http = require("http");
const { URL } = require("url");
const promBundle = require("express-prom-bundle");
const promClient = require('prom-client');
const metricsMiddleware = promBundle({includeMethod: true});
app.use(metricsMiddleware);

const { Cluster } = require("puppeteer-cluster");
const { render_page } = require("./renderer.js");

const g1 = new promClient.Gauge({name: 'puppeteer_cluster_all_target_count', help: 'The total number of targets processed by this Puppeteer cluster'});
const g2 = new promClient.Gauge({name: 'puppeteer_cluster_workers_running_count', help: 'The total number of running workers for this Puppeteer cluster'});
const g3 = new promClient.Gauge({name: 'puppeteer_cluster_queued_count', help: 'The total number of queued requests for this Puppeteer cluster'});
const g4 = new promClient.Gauge({name: 'puppeteer_cluster_error_count', help: 'The total number of error events for this Puppeteer cluster'});

// Get configuration:
const maxConcurrency = parseInt(process.env.PUPPETEER_CLUSTER_SIZE || '2', 10);
const warcproxProxy = process.env.WARCPROX_PROXY || '';

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
    var proxy_url = process.env.HTTP_PROXY;
    // Remove any trailing slash:
    proxy_url = proxy_url.replace(/\/$/,'')
    browserArgs.args.push(`--proxy-server=${proxy_url}`);
    // Record parts:
    var proxy_host = new URL(proxy_url).hostname;
    var proxy_port = new URL(proxy_url).port;
  }
  console.log('Browser arguments: ', browserArgs);


(async () => {
    // Setup cluster:
    console.log(`Starting puppeteer cluster with maxConcurrency = ${maxConcurrency}`)
    const cluster = await Cluster.launch({
        concurrency: Cluster.CONCURRENCY_BROWSER, // < required to ensure extra headers are set properly per URL/task.
        maxConcurrency: maxConcurrency,
        puppeteerOptions: browserArgs,
        timeout: 5*60*1000, // Large 5min timeout by default
    });

    // Event handler to be called in case of problems
    cluster.on('taskerror', (err, data) => {
      console.log(`Error crawling ${data}: ${err.message}`);
    });

    async function post_to_warcprox(uri, data, contentType, 
        warcType, location, warcPrefix) {
      console.log(`Attempting to POST data for ${uri} with warcPrefix ${warcPrefix}`);
        const options = {
            host: proxy_host,
            port: proxy_port,
            path: uri,
            method: 'WARCPROX_WRITE_RECORD',
            headers: {
              'Content-Type': contentType,
              'WARC-Type': warcType,
              'Host': 'ignored.com',
              'Content-Length': Buffer.byteLength(data)
            }
        };

        if( location ) {
          options.headers['Location'] = location;
        }

        if( warcPrefix ) {
          options.headers['Warcprox-Meta'] = JSON.stringify( { 'warc-prefix' : warcPrefix } );
          console.log(`ADDED WARCPROX HEADER. ${warcPrefix}`);
        }
          
          const req = http.request(options, (res) => {
            console.log(`STATUS: ${res.statusCode}`);
            console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
              console.log(`BODY: ${chunk}`);
            });
            res.on('end', () => {
              console.log('No more data in response.');
            });
          });
          
          req.on('error', (e) => {
            console.error(`problem with request: ${e.message}`);
          });
          
          // Write data to request body
          req.write(data);
          req.end();
    }

    await cluster.task(async ({ page, data }) => {
        const url = data.url;
        const warcPrefix = data.warcPrefix;
        await update_metrics()
        // Render the page
        console.log(`${url} cluster.task running render with warcPrefix=${warcPrefix}`);

        // Set up any specified custom headers:
        const extraHeaders = {};
        // Add Memento Datetime header if needed:
        // e.g. Accept-Datetime: Thu, 31 May 2007 20:35:00 GMT
        if ('MEMENTO_ACCEPT_DATETIME' in process.env) {
          extraHeaders['Accept-Datetime'] = process.env.MEMENTO_ACCEPT_DATETIME;
        }
        // Add a warc-prefix as JSON in a Warcprox-Meta: header
        if (warcPrefix) {
          extraHeaders['Warcprox-Meta'] = JSON.stringify( { 'warc-prefix' : warcPrefix } );
        }
        
        //await page.setUserAgent("User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4298.0 Safari/537.36");
        har = await render_page(page, url, extraHeaders);

        // POST records to warcprox if available:
        if ( warcproxProxy ) {
          if ( 'url' in har.urls ) {
            const finalUrl = har.urls.url;
            console.log(`Render appears to have worked (finalUrl = ${finalUrl}). POSTing results to warcprox...`); 
            // DOM
            await post_to_warcprox(
              `onreadydom:${url}`,
              new Buffer.from( har.finalPage.content, 'base64' ),
              har.finalPage.contentType,
              'resource',
              finalUrl,
              warcPrefix,
            );
            // HAR
            await post_to_warcprox(
              `har:${url}`,
              JSON.stringify(har.har),
              'application/json',
              'resource',
              finalUrl,
              warcPrefix,
            );
            // Rendered Elements:
            await har.renderedElements.forEach( async function(relem) {
              console.log(` - ${relem.selector} - ${relem.contentType}`);
              var uriPrefix = 'screenshot';
              if( relem.contentType == 'application/pdf') {
                uriPrefix = 'pdf';
              }
              await post_to_warcprox(
                `${uriPrefix}:${url}#xpointer(${relem.selector})`,
                new Buffer.from( relem.content, 'base64' ),
                relem.contentType,
                'resource',
                finalUrl,
                warcPrefix,
              );
            });
          }
        }
        return har;
    });

    // Helper to update metrics of the cluster:
    async function update_metrics() {
        g1.set(cluster.allTargetCount);
        g2.set(cluster.workersBusy.length);
        g3.set(cluster.jobQueue.size());
        g4.set(cluster.errorCount);
    }

    // setup rendering endpoint:
    app.get('/render', async function (req, res) {
        if (!req.query.url) {
            return res.status(400).end('Please specify url like this: ?url=https://example.com\n');
        }
        try {
            const warcPrefix = req.query.warc_prefix || null;
            const har = await cluster.execute({ url: req.query.url, warcPrefix: warcPrefix });
            await update_metrics();

            if (req.query.show_screenshot) {
                // respond with image:
                screen = new Buffer.from( har.renderedViewport.content, 'base64' );
                res.writeHead(200, {
                    'Content-Type': har.renderedViewport.contentType,
                    'Content-Length': Buffer.byteLength(screen)
                });
                res.end(screen);
            } else {
                // respond with JSON:
                jsonStr = JSON.stringify(har, null, 2);
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(jsonStr)
                });
                res.write(jsonStr);
                res.end();
            }

        } catch (err) {
            // catch error
            res.status(500).send('Error: ' + err.message);
            console.log(err)
        }
    });

    // setup service-is-available endpoint:
    app.get('/', async function (req, res) {
      res.end('OK');
    });

    const port = process.env.PORT || 3000;
    app.listen(port, function () {
        console.log(`Screenshot server listening on port ${port}.`);
    });
})();
