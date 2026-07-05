IMAGE ?= core-mcp-proxy:dev
KIND_CLUSTER ?= kind

check:
	npm run check

build-image:
	docker build -t $(IMAGE) .

push-local-image-kind: build-image
	kind load docker-image $(IMAGE) --name $(KIND_CLUSTER)
