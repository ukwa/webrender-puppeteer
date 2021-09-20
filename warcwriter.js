/* eslint-disable max-len */
/* eslint-disable no-console */
// 'use strict' not required for modules?;

const fs = require('fs');
const { WARCRecord, WARCSerializer } = require("warcio");

const warcVersion = "WARC/1.1";
const warcInfo = {
    "software": "warcio.js in node"
}

const MAX_WARC_SIZE_B = 10*1024;
//const MAX_WARC_PERIOD_MS = 24*60*60*1000;
const MAX_WARC_PERIOD_MS = 60*1000;

class WARCWriter {

    constructor( outputPath, warcPrefix ) {
        this.outputPath = outputPath;
        this.warcPrefix = warcPrefix;
        
        this.stream = null;
        this.written = 0;
        this.openedAt = null;

        // Ensure the current file gets shut down on various exits:
        process.on('exit', this._closeOutputFile);
        process.on('SIGINT', this._closeOutputFile);
        process.on('SIGTERM', this._closeOutputFile);

        var minutes = 1/6.0, the_interval = minutes * 60 * 1000;
        setInterval(() => {WARCWriter._checkRotation(this);}, the_interval);        
    }

    static _checkRotation(warcWriter) {
        console.log(`I am doing my 1 minutes check ${warcWriter.written}, ${warcWriter.openedAt}...`);
        if( warcWriter.written > 0 && (Date.now() - warcWriter.openedAt) > MAX_WARC_PERIOD_MS) {
            warcWriter._closeOutputFile();
        }    
    }

    _closeOutputFile() {
        if( this.stream != null ) {
            this.stream.end();
            // And drop the reference:
            this.stream = null;
        }
    }

    _rotateOutputFile() {
        this._closeOutputFile();
        // Make a new file:
        const filename = this._generateFilename(null,1);
        this.stream = fs.createWriteStream(filename);
        this.stream.filename = filename;
        this.stream.on('close', () => {
            // rename the file:
            console.log(`Output file closed, filename = ${filename}, renaming without .open.`);
            fs.renameSync(filename, filename.slice(0, -5));
        });
    }

    _generateFilename(time, index) {
        if (!time) {
            time = new Date();
        }
      
        const pad = num => (num > 9 ? "" : "0") + num;
        
        var month = time.getFullYear() + "" + pad(time.getMonth() + 1);
        var day = pad(time.getDate());
        var hour = pad(time.getHours());
        var minute = pad(time.getMinutes());
        var seconds = pad(time.getSeconds());
        var ms = time.getMilliseconds();
      
        return `${this.outputPath}/${this.warcPrefix}-${month}${day}${hour}${minute}${seconds}.${ms}-${index}-output.warc.gz.open`;
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
        this.written += serializedRecord.length;
        console.log(`Written ${this.written}...`);
    }

    async _writeWarcInfo(filename) {
        // Slice the .open off the end:
        const warcFilename = filename.slice(0, -5);
        // TODO use just the file name, strip the path:
        const warcInfoRecord = WARCRecord.createWARCInfo({filename: warcFilename, warcVersion}, warcInfo);
        //console.log(warcInfoRecord);
        this.stream.write( await WARCSerializer.serialize(warcInfoRecord, {gzip: true} ) );
    }

    async writeRenderedImage(url, contentType, payload) {
        // Create a sample response
        const date = new Date().toISOString();
        const type = "resource";
        const warcHeaders = {
            "Content-Type": contentType
        };

        console.log(`writeRenderedImage ${url} - ${contentType} - ${typeof payload}`);

        async function* content() {
            yield payload;
        }        

        const record = await WARCRecord.create({url, date, type, warcVersion, warcHeaders, refersToUrl: url}, content());

        //static create({url, date, type, warcHeaders = {}, filename = "",
        //httpHeaders = {}, statusline = "HTTP/1.1 200 OK",
        //warcVersion = WARC_1_0, keepHeadersCase = true, refersToUrl = undefined, refersToDate = undefined} = {}, reader) {

        await this._write(record);
    }

}

module.exports = WARCWriter