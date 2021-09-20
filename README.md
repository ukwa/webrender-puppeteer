webrender-puppeteer
===================

Like https://github.com/ukwa/webrender-phantomjs but backed by [Google Puppeteer](https://github.com/GoogleChrome/puppeteer).

Note that `npm` can be used to control versioning in `package.json` and tagging.  e.g. `npm version major` for a major version bump. Instead of `major` this can be `minor` or `patch`, i.e. SemVer.

Then a `git push origin master --follow-tags`` should build a suitably tagged release.


To Do
=====

- Decide on URI/URN scheme to use for screenshots etc. 
- In WARCInfo, use just the file name, strip the path:
- Create something to quickly check WARC records.
- WARC file name to include unique ID and serial increment.
- warcprox_prefix parameter and passing that through as an extra header, as per
  - extra_headers = { "Warcprox-Meta" : json.dumps( { 'warc-prefix' : warc_prefix}) }
- Tests: simple page, dynamic page, serviceworker, pdf, xml, dead/gone site, unicode URLs
- features (ENV or URL?): USER_AGENT_ADDITIONAL, switchDevices, scaleFactor, viewport width/height, memento datetime,  
-  Debug why switchDevices is reaaallly sloooow on some sites, e.g. www.wired.co.uk, where it also over-crawls.
-  

To add unique process ID:

var crypto = require("crypto");
var id = crypto.randomBytes(20).toString('hex');
// "bb5dc8842ca31d4603d6aa11448d1654"

and incrementing integer padded, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/padStart


