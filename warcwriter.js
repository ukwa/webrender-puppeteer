/* eslint-disable max-len */
/* eslint-disable no-console */
// 'use strict' not required for modules?;

const fs = require('fs');
const rfs = require("rotating-file-stream");
const { WARCRecord, WARCSerializer } = require("warcio");

const warcVersion = "WARC/1.1";
const warcInfo = {
    "software": "warcio.js in node"
}

class WARCWriter {

    constructor( outputPath, warcPrefix ) {
        this.outputPath = outputPath;
        this.warcPrefix = warcPrefix;

        const pad = num => (num > 9 ? "" : "0") + num;
        const generator = (time, index) => {
          if (!time) {
              time = new Date();
          }
          console.log(time)
        
          var month = time.getFullYear() + "" + pad(time.getMonth() + 1);
          var day = pad(time.getDate());
          var hour = pad(time.getHours());
          var minute = pad(time.getMinutes());
          var seconds = pad(time.getSeconds());
          var ms = time.getMilliseconds();
        
          return `${this.outputPath}/${this.warcPrefix}-${month}${day}${hour}${minute}${seconds}.${ms}-${index}-output.warc.gz.open`;
        };
        
        const stream = rfs.createStream(generator, {
          size: "10K",
          interval: "1d",
          immutable: true
        });

        stream.patchReopen = function(fn) {
            this.originalReopen = this.reopen;
            this.reopen = function() {
                    this.originalReopen(...arguments);
                    console.log("AFTER");
                    console.log(this.filename)
                    // Slice the .open off the end:
                    const warcFilename = this.filename.slice(0, -5);
                    // TODO use just the file name, strip the path:
        
                    const warcinfo = WARCRecord.createWARCInfo({filename: warcFilename, warcVersion}, warcInfo);
                    console.log(warcinfo);
                    console.log(this.stream);
                    process.nextTick(() => {
                        this.write("POOP");
                    });

                    WARCSerializer.serialize(warcinfo).then( (serializedRecord) => {
                        stream.write( serializedRecord );
                    });

            }
        };
        stream.patchReopen();

        stream.on('rotated', (filename) => {
            console.log(`Log file rotated event, filename = ${filename}, rename without .open.`);
            //fs.renameSync(filename, filename.slice(0, -5));
        });

        // Store ref in class scope:
        this.stream = stream;
        
    }

    async writeRenderedImage(url, contentType, payload) {
        // Create a sample response
        const date = "2000-01-01T00:00:00Z";
        const type = "resource";
        const warcHeaders = {
            "Content-Type": contentType
        };

        console.log(`writeRenderedImage ${url} - ${contentType} - ${typeof payload}`);

        async function* content() {
            yield payload;
        }        

        const record = await WARCRecord.create({url, date, type, warcVersion, warcHeaders, refersToUrl: url}, content());
        console.log(record);

        //static create({url, date, type, warcHeaders = {}, filename = "",
        //httpHeaders = {}, statusline = "HTTP/1.1 200 OK",
        //warcVersion = WARC_1_0, keepHeadersCase = true, refersToUrl = undefined, refersToDate = undefined} = {}, reader) {
    

        const serializedRecord = await WARCSerializer.serialize(record, {gzip: true});

        this.stream.write(serializedRecord);
    }
}

module.exports = WARCWriter