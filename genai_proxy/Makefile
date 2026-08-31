-include .env.local

PORT ?= $(shell ../tools/port.sh genai-proxy)
HOST ?= 0.0.0.0
ATHENZ_PUBLIC_KEY_PATH ?= ../athenz_dist/keys/zts.public.pem
IMAGE ?= genai-proxy:local
CONTAINER_NAME ?= genai-proxy-local
CONTAINER_PORT ?= 8080
CONTAINER_ATHENZ_PUBLIC_KEY_PATH ?= /run/secrets/zts.public.pem
DATA_DIR ?= ../components/athenzd/.athenzd/genai-proxy-data
CONTAINER_DATA_DIR ?= /var/lib/genai-proxy

export GENAI_UPSTREAM_BASE_URL

.PHONY: local build-image check test

local:
	@if [ -z "$${OPENAI_CODEX_API_KEY:-}" ]; then \
		echo "OPENAI_CODEX_API_KEY must be set before running make genai." >&2; \
		exit 1; \
	fi
	@if [ -z "$${GENAI_UPSTREAM_BASE_URL:-}" ]; then \
		echo "GENAI_UPSTREAM_BASE_URL must be set in the environment or genai_proxy/.env.local." >&2; \
		exit 1; \
	fi
	@if docker container inspect "$(CONTAINER_NAME)" >/dev/null 2>&1; then \
		printf 'Container "%s" already exists. Delete it? [Y/n] ' "$(CONTAINER_NAME)"; \
		if ! read -r answer; then \
			echo; echo 'No response received; keeping the existing container.'; exit 1; \
		fi; \
		case "$${answer:-Y}" in \
			[Yy]|[Yy][Ee][Ss]) docker rm --force "$(CONTAINER_NAME)" >/dev/null ;; \
			*) echo 'Keeping the existing container; make local cancelled.'; exit 1 ;; \
		esac; \
	fi
	@$(MAKE) build-image
	@mkdir -p "$(DATA_DIR)"
	@docker run --detach --rm \
		--name $(CONTAINER_NAME) \
		--add-host host.docker.internal:host-gateway \
		--user "$$(id -u):$$(id -g)" \
		--publish $(HOST):$(PORT):$(CONTAINER_PORT) \
		--env PORT=$(CONTAINER_PORT) \
		--env HOST=0.0.0.0 \
		--env "GENAI_UPSTREAM_BASE_URL=$(GENAI_UPSTREAM_BASE_URL)" \
		--env OPENAI_CODEX_API_KEY \
		--env ATHENZ_PUBLIC_KEY_PATH=$(CONTAINER_ATHENZ_PUBLIC_KEY_PATH) \
		--env USAGE_DATA_PATH=$(CONTAINER_DATA_DIR)/usage.json \
		--mount type=bind,source="$(abspath $(ATHENZ_PUBLIC_KEY_PATH))",target=$(CONTAINER_ATHENZ_PUBLIC_KEY_PATH),readonly \
		--mount type=bind,source="$(abspath $(DATA_DIR))",target=$(CONTAINER_DATA_DIR) \
		$(IMAGE) >/dev/null
	@echo "genai-proxy is running at http://localhost:$(PORT)"

build-image:
	docker build -t $(IMAGE) .

check:
	npm run check

test:
	npm test
