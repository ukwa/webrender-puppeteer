webrender-puppeteer
===================

Like https://github.com/ukwa/webrender-phantomjs but backed by [Google Puppeteer](https://github.com/GoogleChrome/puppeteer).

Note that `npm` can be used to control versioning in `package.json` and tagging.  e.g. `npm version major` for a major version bump. Instead of `major` this can be `minor` or `patch`, i.e. SemVer.

Then a `git push origin master --follow-tags`` should build a suitably tagged release.


To Do
=====

 - Check 204 status, throw error if it didn't work
 - warcprox_prefix parameter and passing that through as an extra header, as per
   - extra_headers = { "Warcprox-Meta" : json.dumps( { 'warc-prefix' : warc_prefix}) }
 - har
 - imagemap
 - thumbnail?
 - Tests: simple page, dynamic page, serviceworker, pdf, xml, dead/gone site, unicode URLs
 - features (ENV or URL?): USER_AGENT_ADDITIONAL, switchDevices, scaleFactor, viewport width/height, memento datetime, 


def build_imagemap(page_jpeg, page):
    html = "<html><head><title>%s [Static version of %s]</title>\n</head>\n<body style=\"margin: 0;\">\n" % (page['title'], page['url'])
    html = html + '<img src="data:image/jpeg;base64,%s" usemap="#shapes" alt="%s">\n' %( base64.b64encode(page_jpeg).decode('utf-8'), page['title'])
    html = html + '<map name="shapes">\n'
    for box in page['map']:
        if 'href' in box:
            x1 = box['location']['left']
            y1 = box['location']['top']
            x2 = x1 + box['location']['width']
            y2 = y1 + box['location']['height']
            html = html + '<area shape=rect coords="%i,%i,%i,%i" href="%s">\n' % (x1,y1,x2,y2,box['href'])
        else:
            logger.debug("Skipping box with no 'href': %s" % box)
    html = html + '</map>\n'
    html = html + "</body>\n</html>\n"
    return html
  