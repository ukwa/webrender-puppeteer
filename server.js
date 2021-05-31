const app = require("express")();

const e = require("express");
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
let maxConcurrency = 2;
if ('PUPPETEER_CLUSTER_SIZE' in process.env) {
    maxConcurrency = parseInt(process.env.PUPPETEER_CLUSTER_SIZE);
}

(async () => {
    // Setup cluster:
    console.log(`Starting puppeteer cluster with maxConcurrency = ${maxConcurrency}`)
    const cluster = await Cluster.launch({
        concurrency: Cluster.CONCURRENCY_CONTEXT,
        maxConcurrency: maxConcurrency,
        timeout: 5*60*1000, // Large 5min timeout by default
    });

    await cluster.task(async ({ page, data: url }) => {
        update_metrics()
        // make a screenshot
        har = await render_page(page, url);
        return har;
    });

    // Helper to update metrics of the cluster:
    async function update_metrics() {
        g1.set(cluster.allTargetCount);
        g2.set(cluster.workersBusy.length);
        g3.set(cluster.jobQueue.size());
        g4.set(cluster.errorCount);
    }

    // setup server
    app.get('/render', async function (req, res) {
        if (!req.query.url) {
            return res.end('Please specify url like this: ?url=https://example.com');
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

    app.listen(3000, function () {
        console.log('Screenshot server listening on port 3000.');
    });
})();