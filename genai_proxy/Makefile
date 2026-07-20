PORT ?= $(shell ../tools/port.sh genai-proxy)
HOST ?= 0.0.0.0
OLLAMA_BASE_URL ?= http://host.docker.internal:11434
ATHENZ_PUBLIC_KEY_PATH ?= ../athenz_dist/keys/zts.public.pem
IMAGE ?= genai-proxy:local
CONTAINER_NAME ?= genai-proxy-local
CONTAINER_PORT ?= 8080
CONTAINER_ATHENZ_PUBLIC_KEY_PATH ?= /run/secrets/zts.public.pem

.PHONY: local build-image check test

local: build-image
	@docker run --detach --rm \
		--name $(CONTAINER_NAME) \
		--add-host host.docker.internal:host-gateway \
		--publish $(HOST):$(PORT):$(CONTAINER_PORT) \
		--env PORT=$(CONTAINER_PORT) \
		--env HOST=0.0.0.0 \
		--env "OLLAMA_BASE_URL=$(OLLAMA_BASE_URL)" \
		--env ATHENZ_PUBLIC_KEY_PATH=$(CONTAINER_ATHENZ_PUBLIC_KEY_PATH) \
		--mount type=bind,source="$(abspath $(ATHENZ_PUBLIC_KEY_PATH))",target=$(CONTAINER_ATHENZ_PUBLIC_KEY_PATH),readonly \
		$(IMAGE) >/dev/null
	@echo "genai-proxy is running at http://localhost:$(PORT)"

build-image:
	docker build -t $(IMAGE) .

check:
	npm run check

test:
	npm test
