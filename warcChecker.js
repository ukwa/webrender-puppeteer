/* eslint-disable max-len */
/* eslint-disable no-console */

const { WARCParser, WARCRecord, WARCSerializer } = require("warcio");
const fs = require('fs');


async function readWARC(filename) {

    stream = fs.createWriteStream("out.warc.gz");


    console.log("Processing "+filename);
    const nodeStream = fs.createReadStream(filename);

    const parser = new WARCParser(nodeStream);

    for await (const record of parser) {
        // ways to access warc data
        console.log("warcType: " + record.warcType);
        console.log("warcTargetURI: " + record.warcTargetURI);
        console.log(record.warcHeaders.headers.get('WARC-Record-ID'));

        // iterator over WARC content one chunk at a time (as Uint8Array)
        //for await (const chunk of record) {
        
        //}

        if( record.warcType == 'resource') {
            const serializedRecord = await WARCSerializer.serialize(record, {gzip: true});
            stream.write(serializedRecord);
        }

        // OR, access content as text
        //const text = await record.contentText();
    }

    // Close
    stream.end();
}

readWARC(process.argv[2]);