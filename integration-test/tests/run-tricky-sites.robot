*** Settings ***
Library    Collections
Library    RequestsLibrary

*** Keywords ***
Render This URL
    [Arguments]    ${url}
    Log To Console 	Rendering ${url} (5m timeout)...
    ${response}=    GET  http://webrender:8010/render  params=url=${url}  expected_status=200  timeout=660

*** Test Cases ***
Render Tricky Sites
    Sleep    10s    Waiting for the container to start...
    Render This URL    http://acid.matkelly.com/
    Render This URL    http://data.webarchive.org.uk/crawl-test-site/
    Render This URL    http://data.webarchive.org.uk/crawl-test-site/sitemap.xml
    Render This URL    https://twitter.com/UKWebArchive/
    Render This URL    https://www.huffingtonpost.co.uk/
    Render This URL    https://www.theguardian.com/uk
    Render This URL    https://www.bbc.co.uk/news
# This is really slow:
#    Render This URL    https://www.wired.co.uk/
