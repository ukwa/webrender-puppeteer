*** Settings ***
Library    Collections
Library    RequestsLibrary

*** Keywords ***
Render This URL
    [Arguments]     ${url}
    &{params}=      Create Dictionary    url=${url}    warc_prefix=BL-WEBRENDER-WARCPROX
    Log To Console 	Rendering ${url} (5m timeout)...
    ${response}=    GET  http://webrender:8010/render  params=${params}  expected_status=200  timeout=660

*** Test Cases ***
Render Sites With Banners To Clear
    Sleep    10s    Waiting for the container to start...
    Render This URL    https://www.huffingtonpost.co.uk/
    Render This URL    https://www.theguardian.com/uk
    Render This URL    https://www.bbc.co.uk/news

Render A Twitter Page  # Involves infinite scroll, and a service worker
    Render This URL    https://twitter.com/UKWebArchive/

Render Test Sites
    Render This URL    http://acid.matkelly.com/
    Render This URL    http://data.webarchive.org.uk/crawl-test-site/

Render An XML Page
    Render This URL    http://data.webarchive.org.uk/crawl-test-site/sitemap.xml

Render A PDF
    Render This URL    https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/998878/aa1-interactive-claim-form.pdf

Handle Missing URLs
    Render This URL    http://thisdomaindoesnot.exist/
    Render This URL    http://acid.matkelly.com/thisRequestWill404.html

#Render A Very Complicated Site  # This is really slow!
#    Render This URL    https://www.wired.co.uk/
