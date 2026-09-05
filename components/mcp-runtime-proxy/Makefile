PORT ?= 8082
MCP_TARGET_URL ?= http://127.0.0.1:8080
IMAGE ?= mcp-runtime-proxy:dev
KIND_CLUSTER ?= kind

.PHONY: check test local build-image push-local-image-kind

check:
	npm run check

test:
	npm test

local:
	PORT=$(PORT) MCP_TARGET_URL=$(MCP_TARGET_URL) npm start

build-image:
	docker build -t $(IMAGE) .

push-local-image-kind: build-image
	kind load docker-image $(IMAGE) --name $(KIND_CLUSTER)
