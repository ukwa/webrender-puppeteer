webrender-puppeteer
===================

Like https://github.com/ukwa/webrender-phantomjs but backed by [Google Puppeteer](https://github.com/GoogleChrome/puppeteer).

Note that `npm` can be used to control versioning in `package.json` and tagging.  e.g. `npm version major` for a major version bump. Instead of `major` this can be `minor` or `patch`, i.e. SemVer.

Then a `git push origin master --follow-tags`` should build a suitably tagged release.


To Do
=====

Prior to deployment

- [x] Decide on URI/URN scheme to use for screenshots etc.  -- Sticking to current scheme for now.
- [x] In WARCInfo, use just the file name, strip the path:
- [x] Create something to quickly check WARC records. -- ReplayWeb app works fine for this for now.
- [x] WARC file name to include unique ID and serial increment.
- [x] Use warcprox_prefix parameter and passing that through as an extra header, as per
  - extra_headers = { "Warcprox-Meta" : json.dumps( { 'warc-prefix' : warc_prefix}) }
- [x] USER_AGENT_ADDITIONAL 

Later:

- Tests: simple page, dynamic page, serviceworker, pdf, xml, dead/gone site, unicode URLs
- Verification: Some kind of rapid overview of results so test cases can be checked quickly.
- features (ENV or URL?): , switchDevices, scaleFactor, viewport width/height, memento datetime,  
- Debug why switchDevices is reaaallly sloooow on some sites, e.g. www.wired.co.uk, where it also over-crawls.
- Also check aria-label="Close" style buttons?
- Switch screenshots over to a cleaner URN scheme, possibly PWIDs.

Current test sites:

- ACID http://acid.matkelly.com/
- Crawl Test Site http://data.webarchive.org.uk/crawl-test-site/
- A Sitemap http://data.webarchive.org.uk/crawl-test-site/sitemap.xml
- A Twitter Account https://twitter.com/UKWebArchive/
- HuffPo UK https://www.huffingtonpost.co.uk/
- Guardian https://www.theguardian.com/uk
- BBC News https://www.bbc.co.uk/news
- Wired https://www.wired.co.uk/
