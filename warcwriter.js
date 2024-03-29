/* eslint-disable max-len */
/* eslint-disable no-console */
// 'use strict' not required for modules?;

const fs = require('fs');
const path = require("path");
const Crypto = require('crypto')
const { WARCRecord, WARCSerializer } = require("warcio");

const warcVersion = "WARC/1.1";

// 1GB default WARC size:
const MAX_WARC_SIZE_B = parseInt(process.env.MAX_WARC_SIZE_B || '0', 10) || 1000*1000*1000; 

// 1 day default WARC period:
const MAX_WARC_PERIOD_MS = parseInt(process.env.MAX_WARC_PERIOD_MS || '0', 10) || 24*60*60*1000; 

/**
 * 
 */
class WARCWriter {

    constructor( outputPath, warcPrefix, warcInfo ) {
        this.outputPath = outputPath;
        this.warcPrefix = warcPrefix;
        this.warcInfo = warcInfo;
        
        this.stream = null;
        this.written = 0;
        this.openedAt = null;
        this.writerId = WARCWriter.randomId();
        this.index = -1; // Sequence ID for WARC file, incremented before minting the name.

        // Store a reference to this where the shutdown handler can get to it:
        var self = this;

        const shutdownHandler = function() {
            console.log("Running shutdown handler...")
            if( self.stream != null ) {
                const filename = self.stream.filename;
                self._closeOutputFile();
                WARCWriter._renameOpenWarcFile(filename);
            } else {
                console.log("Stream is NULL.");
            }
        }

        // Ensure the current file gets shut down on various exits:
        process.on('exit', shutdownHandler);
        process.on('SIGTERM', shutdownHandler);

        // Set up the watcher task that checks for the age of WARCs:
        var the_interval = Math.round(MAX_WARC_PERIOD_MS/100) + 1000; // (at least one second)
        setInterval(() => {WARCWriter._checkRotation(this);}, the_interval);

        // Log configuration settings:
        console.log("Maximum WARC size setting (b): " + MAX_WARC_SIZE_B);
        console.log("Maximum WARC duration setting (ms): " + MAX_WARC_PERIOD_MS);
        console.log("Maximum WARC duration check interval (ms): " + the_interval);
    }

    static randomId(size = 8) { 
        return Crypto
            .randomBytes(size)
            .toString('base64url')
            .slice(0, size).toLowerCase();
    }

    static _checkRotation(warcWriter) {
        console.log(`Checking age of ${warcWriter.written}, ${warcWriter.openedAt}...`);
        if( warcWriter.written > 0 && (Date.now() - warcWriter.openedAt) > MAX_WARC_PERIOD_MS) {
            warcWriter._closeOutputFile();
        }    
    }

    static _renameOpenWarcFile(filename) {
        if( fs.existsSync(filename)) {
            console.log(`Output file closed, filename = ${filename}, renaming without .open.`);
            fs.renameSync(filename, filename.slice(0, -5));
        }
    }

    _closeOutputFile() {
        if( this.stream != null ) {
            console.log(`Closing output file ${this.stream.filename} ...`);
            this.stream.end();
            // And drop the reference:
            this.stream = null;
        }
    }

    _rotateOutputFile() {
        this._closeOutputFile();
        // Make a new file:
        const filename = this._generateFilename(null);
        this.filename = filename;
        this.stream = fs.createWriteStream(filename);
        this.stream.filename = filename;
        this.stream.on('close', () => {
            // rename the file:
            WARCWriter._renameOpenWarcFile(filename);
        });
    }

    _generateFilename(time) {
        if (!time) {
            time = new Date();
        }

        // Increment the index:
        this.index += 1;

        // How to pad:
        const pad = num => (num > 9 ? "" : "0") + num;
        
        var month = time.getFullYear() + "" + pad(time.getMonth() + 1);
        var day = pad(time.getDate());
        var hour = pad(time.getHours());
        var minute = pad(time.getMinutes());
        var seconds = pad(time.getSeconds());
        var ms = time.getMilliseconds().toString().padStart(3,'0');
      
        return `${this.outputPath}/${this.warcPrefix}-${month}${day}${hour}${minute}${seconds}${ms}-${this.index.toString().padStart(5,'0')}-${this.writerId}.warc.gz.open`;
    };

    async _write(record) {
        // Due for a new file?
        if( this.stream == null || this.written > MAX_WARC_SIZE_B ) {
            console.log("Rotating output file...");
            this._rotateOutputFile();
            this.written = 0;
            this.openedAt = Date.now();
            await this._writeWarcInfo(this.stream.filename);
        }
        //console.log(record);
        const serializedRecord = await WARCSerializer.serialize(record, {gzip: true});
        this.stream.write(serializedRecord);
        this.written += Buffer.byteLength(serializedRecord);
        console.log(`Written ${this.written}...`);
    }

    async _writeWarcInfo(filename) {
        // Just the filename, and slice the .open off the end:
        const warcFilename = path.basename(filename.slice(0, -5));
        const warcInfoRecord = WARCRecord.createWARCInfo({filename: warcFilename, warcVersion}, this.warcInfo);
        //console.log(warcInfoRecord);
        this.stream.write( await WARCSerializer.serialize(warcInfoRecord, {gzip: true} ) );
    }

    async writeRenderedImageFromBuffer(url, contentType, payload) {
        async function* content() {
            yield payload;
        }

        const contentLength = Buffer.byteLength(payload);

        await this.writeRenderedImage(url, contentType, content, contentLength);
    }

    async writeRenderedImage(url, contentType, content, contentLength=null) {
        // Create a sample response
        const date = new Date().toISOString();
        const type = "resource";
        const warcHeaders = {
            "Content-Type": contentType
        };
        if( contentLength != null ) {
            warcHeaders['Content-Length'] = contentLength;
        }

        console.log(`writeRenderedImage ${url} - ${contentType} - ${typeof payload}`);

        const record = await WARCRecord.create({url, date, type, warcVersion, warcHeaders, refersToUrl: url}, content());

        //static create({url, date, type, warcHeaders = {}, filename = "",
        //httpHeaders = {}, statusline = "HTTP/1.1 200 OK",
        //warcVersion = WARC_1_0, keepHeadersCase = true, refersToUrl = undefined, refersToDate = undefined} = {}, reader) {

/*
WARC/1.0
WARC-Type: resource
WARC-Record-ID: <urn:uuid:2f3d9696-506a-4987-8610-6efd319d5aa3>
WARC-Date: 2021-09-11T22:26:51Z
WARC-Target-URI: screenshot:http://crawl-test-site.webarchive.org.uk/
Content-Type: image/png
Content-Length: 86966
WARC-Block-Digest: sha1:WGZXBS7NYMDJZRCNGI3JVDLN3IX7NYHK
WARC-Payload-Digest: sha1:WGZXBS7NYMDJZRCNGI3JVDLN3IX7NYHK

*/

        await this._write(record);
    }

    /*

        // Iterate through the Readable stream chunks:
         async function* content() {
           for await (const chunk of pdf) {
          yield chunk;
           }
         } 
         */    

}

module.exports = WARCWriter