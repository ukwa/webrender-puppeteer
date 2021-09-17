/* eslint-disable max-len */
/* eslint-disable no-console */
// 'use strict' not required for modules?;

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
        
          return `${this.outputPath}/${this.warcPrefix}-${month}${day}-${hour}${minute}-${index}-output.warc.gz`;
        };
        
        const stream = rfs.createStream(generator, {
          size: "1G",
          interval: "1d",
          immutable: true
        });

        stream.on('open', async (filename) => {
            // First, create a warcinfo record
 
            const warcinfo =  await WARCRecord.createWARCInfo({filename, warcVersion}, warcInfo);

            const serializedWARCInfo =  await WARCSerializer.serialize(warcinfo, {gzip: true});

            this.stream.write(serializedWARCInfo);

        });

        // Store ref in class scope:
        this.stream = stream;
        
    }

    async writeRenderedImage(url, contentType, payload) {
        // Create a sample response
        const date = "2000-01-01T00:00:00Z";
        const type = "resource";
        const headers = {
            "Content-Type": contentType
        };

        console.log(`writeRenderedImage ${url} - ${contentType} - ${typeof payload}`);

        async function* content() {
            yield payload;
        }        

        const record = await WARCRecord.create({url, date, type, warcVersion, headers}, content());

        const serializedRecord = await WARCSerializer.serialize(record, {gzip: true});

        this.stream.write(serializedRecord);
    }
}

module.exports = WARCWriter