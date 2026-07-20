PORT ?= $(shell ../tools/port.sh genai-proxy)
HOST ?= 0.0.0.0
OLLAMA_BASE_URL ?= http://127.0.0.1:11434
ATHENZ_PUBLIC_KEY_PATH ?= ../athenz_dist/keys/zts.public.pem

.PHONY: local check test

local: check
	PORT=$(PORT) HOST=$(HOST) OLLAMA_BASE_URL=$(OLLAMA_BASE_URL) ATHENZ_PUBLIC_KEY_PATH=$(ATHENZ_PUBLIC_KEY_PATH) npm start

check:
	npm run check

test:
	npm test
