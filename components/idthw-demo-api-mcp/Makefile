PORT ?= 8080
UPSTREAM_BASE_URL ?= http://127.0.0.1:14443
IMAGE ?= idthw-demo-api-mcp:dev

.PHONY: check test local build-image

check:
	npm run check

test:
	npm test

local:
	PORT=$(PORT) UPSTREAM_BASE_URL=$(UPSTREAM_BASE_URL) npm start

build-image:
	docker build -t $(IMAGE) .
