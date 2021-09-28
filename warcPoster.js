/* eslint-disable max-len */
/* eslint-disable no-console */
/**
 * Rather that writing WARCs locally, this posts them to a WARC writing proxy.
 */
const { Readable } = require('stream');
const http = require("http");
const { URL } = require("url");

const proxy_url = process.env.HTTP_PROXY || null;
const proxySupportsWarcWriteRecord = process.env.WARCPROX_PROXY || '';

class WARCPoster {

    constructor(){
        if (proxy_url != null ) {
            this.proxy_host = new URL(proxy_url).hostname;
            this.proxy_port = new URL(proxy_url).port;
        } else {
            console.log("WARNING: No proxy_url set!");
        }
        console.log("Proxy Supports WARCPROX_WRITE_RECORD: " + proxySupportsWarcWriteRecord);
    }
    
    async _write_record(uri, stream, contentType, contentLength, warcType, location, warcPrefix) {
        console.log(`Attempting to POST data for ${uri} with warcPrefix ${warcPrefix}`);

        const options = {
            host: this.proxy_host,
            port: this.proxy_port,
            path: uri,
            method: 'WARCPROX_WRITE_RECORD',
            headers: {
                'Content-Type': contentType,
                'WARC-Type': warcType,
                'Host': 'ignored.com'
            }
        };

        if( contentLength != null ) {
            options.headers['Content-Length'] = contentLength;
        }

        if( location ) {
            options.headers['Location'] = location;
        }

        if( warcPrefix ) {
            options.headers['Warcprox-Meta'] = JSON.stringify( { 'warc-prefix' : warcPrefix } );
        }

        // We force this to be handled synchronously/awaited as we need 
        // the browser session to still be there if we are consuming a streamed pdf:
        let postPromise = new Promise((resolve, reject) => {
            const req = http.request(options, (res) => {
                if( res.statusCode != 204) {
                    reject( Error(`Got status code ${res.statusCode} when POSTing record for ${uri}!`) );
                }
                // Also emit body for debugging:
                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                    console.log(`${chunk}`);
                });
                res.on('end', () => {
                    resolve();
                });
                res.on('error', (error) => {
                    reject(error);
                });
            });
            
            req.on('error', (e) => {
                reject(e);
            });
            
            // Pipe and close the request:
            stream.pipe(req);
        });

        // And await completion:
        await postPromise;

    }

    async writeRenderedImageFromBuffer(warcPrefix, url, finalUrl, contentType, payload) {
        const contentLength = Buffer.byteLength(payload);

        function bufferToStream(buffer) { 
            var stream = new Readable();
            stream.push(buffer);
            stream.push(null);
          
            return stream;
        }
        const stream = bufferToStream(payload);

        await this.writeRenderedImage(warcPrefix, url, finalUrl, contentType, stream, contentLength);
    }

    async writeRenderedImage(warcPrefix, url, finalUrl, contentType, stream, contentLength) {
        if ( proxy_url == null ) {
            console.log("ERROR! No proxy URL set!");
            return;
        }

        if ( proxySupportsWarcWriteRecord ) {

            // We have to know the content length, so write to a temp file and use that if the contentLength is unset:
            if( contentLength == null ) {
                return Error("Content length must be set!");
            }

            await this._write_record(
                url,
                stream,
                contentType,
                contentLength,
                'resource',
                finalUrl,
                warcPrefix,
            );
        } else {
            console.log("WARNING! Discarding rendered WARC record because proxy does not support WARC_WRITE_RECORD.");
        }
    }

}

module.exports = WARCPoster