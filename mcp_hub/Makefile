PORT ?= 3102
OPEN_UI ?= false
MCP_HUB_ZTS_URL ?= https://localhost:$(shell ../tools/port.sh zts)/zts/v1

.PHONY: build local

build:
	npm run build

local:
	npm install
	if [ "$(OPEN_UI)" = "true" ]; then (../tools/open.sh "http://localhost:$(PORT)" &); fi
	MCP_HUB_ZTS_URL="$(MCP_HUB_ZTS_URL)" npm run dev -- --port $(PORT)
