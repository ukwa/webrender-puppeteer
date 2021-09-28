webrender-puppeteer
===================

Like https://github.com/ukwa/webrender-phantomjs but backed by [Google Puppeteer](https://github.com/GoogleChrome/puppeteer).

Note that `npm` can be used to control versioning in `package.json` and tagging.  e.g. `npm version major` for a major version bump. Instead of `major` this can be `minor` or `patch`, i.e. SemVer.

Then a `git push origin master --follow-tags`` should build a suitably tagged release.

Versions
--------

The version 1 series was intended to be run via `ukwa/webrender-api` as Docker as a command that emitted files, which the calling service returned.

Version 2 includes a native Node server that provides the same API, thus avoiding the problems caused by running very large numbers of Docker containers very quickly.

To Do
-----

Prior to deployment

- [x] Decide on URI/URN scheme to use for screenshots etc.  -- Sticking to current scheme for now.
- [x] In WARCInfo, use just the file name, strip the path:
- [x] Create something to quickly check WARC records. -- _ReplayWeb.page_ app works fine for this for now.
- [x] WARC file name to include unique ID and serial increment.
- [x] Use warcprox_prefix parameter and passing that through as an extra header, as per
  - extra_headers = { "Warcprox-Meta" : json.dumps( { 'warc-prefix' : warc_prefix}) }
- [x] USER_AGENT_ADDITIONAL 
- [x] Do _not_ use `{{` and `}}` for the version substitution as this conflicts with Docker Swarm. Using `@VERSION@` instead.
- [ ] Decide how to handle separation of content. See below.

In previous versions, records were sent to `warcprox` and the `warcPrefix` was used to separate WARCs into different streams. This version now stores the rendered content directly, in a single WARC file set. Therefore, to keep e.g. NPLD and By-Permission crawled data separate, we need a separate instance of the `webrender` service.

This seems a little clumsy, but then given the passing-a-warcPrefix-header approach is a bit brittle/flaky, it would probably make sense to have fully separate crawlers, with separate `warcprox` instances as well as `webrender` instances. Given we want the option of switching to using `pywb` as the WARC-writing proxy (so we gain it's advantages over `warcprox`, like fetching full files when the client makes range requests), this is probably a good idea/inevitable.

Later:

- [ ] Switch from `warcprox` to `pywb` - requires at least the equivalent of the CDX updater, and ideally the Kafka crawl log too.
- Tests: simple page, dynamic page, serviceworker, pdf, xml, dead/gone site, unicode URLs
- Verification: Some kind of rapid overview of results so test cases can be checked quickly.
- features (ENV or URL?): , switchDevices, scaleFactor, viewport width/height, memento datetime.
- Trial running this with switchDevices post-crawl via CrawlCache/pywb patch mode.
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

Change Log
----------

- 2.1.0: Switch back to recording rendered WARCs via warcprox, so WARC file prefix naming and Kafka/CDX integration are retained.
- 2.0.0: First Node implementation of the WebRender API.
