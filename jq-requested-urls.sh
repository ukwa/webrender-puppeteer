jq --tab ".log.entries[].response.url" output/rendered.har | sort
