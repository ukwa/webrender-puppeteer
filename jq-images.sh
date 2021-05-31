jq -r ".renderedViewport.content" $1 | base64 --decode > viewport.jpg
jq -r ".renderedElements[0].content" $1 | base64 --decode > page.png

