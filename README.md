webrender-puppeteer
===================

Like https://github.com/ukwa/webrender-phantomjs but backed by [Google Puppeteer](https://github.com/GoogleChrome/puppeteer).

 - [ ] Keep webrender-phantomjs but rename to webrender-api? Or fork and clean-up?
 - [ ] Remove code that runs PhantomJS.
 - [ ] Modify to run this Puppeteer inside Docker, and use a volume mount to push the results into separate files per render task.
 - [ ] Modify code to take these files and push them to warcprox.
