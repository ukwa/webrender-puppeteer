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
        concurrency: Cluster.CONCURRENCY_CONTEXT,
        maxConcurrency: maxConcurrency,
        puppeteerOptions: browserArgs,
        timeout: 5*60*1000, // Large 5min timeout by default
    });

    function post_to_warcprox(uri, data, contentType, warcType='resource', location=null, extraHeaders=[]) {
      console.log(`Attempting to POST data for ${uri}`);
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

    await cluster.task(async ({ page, data: url }) => {
        update_metrics()
        // Render the page
        har = await render_page(page, url);
        // POST records to warcprox if available:
        if ( warcproxProxy ) {
          if ( 'url' in har.urls ) {
            console.log("Render appears to have worked. POSTing results to warcprox..."); 
            const finalUrl = har.urls.url;
            // DOM
            post_to_warcprox(
              `onreadydom:${url}`,
              new Buffer.from( har.finalPage.content, 'base64' ),
              har.finalPage.contentType,
              location=finalUrl,
            );
            // HAR
            post_to_warcprox(
              `har:${url}`,
              JSON.stringify(har.har),
              'application/json',
              location=finalUrl,
            );
            // Rendered Elements:
            har.renderedElements.forEach(function(relem) {
              console.log(` - ${relem.selector} - ${relem.contentType}`);
              var uriPrefix = 'screenshot';
              if( relem.contentType == 'application/pdf') {
                uriPrefix = 'pdf';
              }
              post_to_warcprox(
                `${uriPrefix}:${url}#xpointer(${relem.selector})`,
                new Buffer.from( relem.content, 'base64' ),
                relem.contentType,
                location=finalUrl,
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
            const har = await cluster.execute(req.query.url);
            update_metrics();

            if (req.query.show_screenshot) {
                // respond with image:
                screen = new Buffer.from( har.renderedViewport.content, 'base64' );
                res.writeHead(200, {
                    'Content-Type': har.renderedViewport.contentType,
                    'Content-Length': screen.length
                });
                res.end(screen);
            } else {
                // respond with JSON:
                jsonStr = JSON.stringify(har);
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Content-Length': jsonStr.length
                });
                res.end(jsonStr);
            }

        } catch (err) {
            // catch error
            res.end('Error: ' + err.message);
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
