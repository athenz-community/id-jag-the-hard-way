PORT ?= 3102
HOST ?= 127.0.0.1
OPEN_UI ?= false
AUTH_SECRET ?= idthw-mcp-hub-local-auth-secret
AUTH_URL ?= http://localhost:$(PORT)
MCP_HUB_IDP_NAME ?= Keycloak
MCP_HUB_IDP_ISSUER ?= https://keycloak.idp:$(shell ../tools/port.sh keycloak-https)/realms/master
MCP_HUB_IDP_PUBLIC_ISSUER ?= $(MCP_HUB_IDP_ISSUER)
MCP_HUB_IDP_WELL_KNOWN ?= $(MCP_HUB_IDP_ISSUER)/.well-known/openid-configuration
MCP_HUB_IDP_TOKEN_ENDPOINT ?= $(MCP_HUB_IDP_ISSUER)/protocol/openid-connect/token
MCP_HUB_IDP_CLIENT_ID ?= mcp-hub.hub-ui
MCP_HUB_IDP_CLIENT_SECRET ?= mcp-hub-local-secret
MCP_HUB_ATHENZ_UI_URL ?= http://localhost:$(shell ../tools/port.sh athenz-ui)
MCP_HUB_ZMS_URL ?= https://host.docker.internal:$(shell ../tools/port.sh zms)/zms/v1
MCP_HUB_ZMS_TLS_SERVER_NAME ?= localhost
MCP_HUB_ZTS_URL ?= https://host.docker.internal:$(shell ../tools/port.sh zts)/zts/v1
MCP_HUB_LOCAL_MCP_URL ?= http://host.docker.internal:$(shell ../tools/port.sh mcp)/mcp
GENAI_PROXY_URL ?= http://host.docker.internal:$(shell ../tools/port.sh genai-proxy)
IMAGE ?= mcp-hub:local
CONTAINER_NAME ?= mcp-hub-local
CONTAINER_PORT ?= 3102
CONTAINER_CERT_DIR ?= /app/certs
KUBECONFIG_PATH ?= $(HOME)/.kube/config
CONTAINER_KUBECONFIG_PATH ?= /root/.kube/config
MCP_HUB_KUBECTL_SERVER ?= $(shell kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null | sed -E 's\#://(127\.0\.0\.1|localhost)(:|/)\#://host.docker.internal\2\#')
MCP_HUB_KUBECTL_TLS_SERVER_NAME ?= $(shell kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null | sed -E 's\#https?://([^:/]+).*\#\1\#')

.PHONY: build build-image local register-idp-client

build:
	npm install
	npm run build
	cp -R public .next/standalone/
	mkdir -p .next/standalone/.next
	cp -R .next/static .next/standalone/.next/

build-image:
	docker build -t $(IMAGE) .

register-idp-client:
	cd .. && \
		KEYCLOAK_CLIENT_SECRET="$(MCP_HUB_IDP_CLIENT_SECRET)" \
		KEYCLOAK_POST_LOGOUT_REDIRECT_URI="http://localhost:$(PORT)/api/auth/idp-logout/complete" \
		KEYCLOAK_OPEN_UI=false \
		./tools/keycloak/create-client.sh \
		"$(MCP_HUB_IDP_CLIENT_ID)" \
		"http://localhost:$(PORT)/api/auth/callback/idp" \
		"http://localhost:$(PORT)" \
		confidential

local:
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
	@docker run --detach --rm \
		--name $(CONTAINER_NAME) \
		--add-host host.docker.internal:host-gateway \
		--add-host keycloak.idp:host-gateway \
		--publish $(HOST):$(PORT):$(CONTAINER_PORT) \
		--env PORT=$(CONTAINER_PORT) \
		--env HOSTNAME=0.0.0.0 \
		--env "AUTH_SECRET=$(AUTH_SECRET)" \
		--env "AUTH_URL=$(AUTH_URL)" \
		--env AUTH_TRUST_HOST=true \
		--env NODE_EXTRA_CA_CERTS=$(CONTAINER_CERT_DIR)/ca.crt \
		--env "MCP_HUB_IDP_NAME=$(MCP_HUB_IDP_NAME)" \
		--env "MCP_HUB_IDP_ISSUER=$(MCP_HUB_IDP_ISSUER)" \
		--env "MCP_HUB_IDP_PUBLIC_ISSUER=$(MCP_HUB_IDP_PUBLIC_ISSUER)" \
		--env "MCP_HUB_IDP_WELL_KNOWN=$(MCP_HUB_IDP_WELL_KNOWN)" \
		--env "MCP_HUB_IDP_TOKEN_ENDPOINT=$(MCP_HUB_IDP_TOKEN_ENDPOINT)" \
		--env "MCP_HUB_IDP_CLIENT_ID=$(MCP_HUB_IDP_CLIENT_ID)" \
		--env "MCP_HUB_IDP_CLIENT_SECRET=$(MCP_HUB_IDP_CLIENT_SECRET)" \
		--env "MCP_HUB_ATHENZ_UI_URL=$(MCP_HUB_ATHENZ_UI_URL)" \
		--env "MCP_HUB_ZMS_URL=$(MCP_HUB_ZMS_URL)" \
		--env "MCP_HUB_ZMS_TLS_SERVER_NAME=$(MCP_HUB_ZMS_TLS_SERVER_NAME)" \
		--env "MCP_HUB_ZTS_URL=$(MCP_HUB_ZTS_URL)" \
		--env "MCP_HUB_LOCAL_MCP_URL=$(MCP_HUB_LOCAL_MCP_URL)" \
		--env "GENAI_PROXY_URL=$(GENAI_PROXY_URL)" \
		--env MCP_HUB_CERT_DIR=$(CONTAINER_CERT_DIR) \
		--env KUBECONFIG=$(CONTAINER_KUBECONFIG_PATH) \
		--env "MCP_HUB_KUBECTL_SERVER=$(MCP_HUB_KUBECTL_SERVER)" \
		--env "MCP_HUB_KUBECTL_TLS_SERVER_NAME=$(MCP_HUB_KUBECTL_TLS_SERVER_NAME)" \
		--mount type=bind,source="$(abspath certs)",target=$(CONTAINER_CERT_DIR),readonly \
		--mount type=bind,source="$(abspath $(KUBECONFIG_PATH))",target=$(CONTAINER_KUBECONFIG_PATH),readonly \
		$(IMAGE) >/dev/null
	@if [ "$(OPEN_UI)" = "true" ]; then (../tools/open.sh "http://localhost:$(PORT)" &); fi
	@echo "MCP Hub UI is running at http://localhost:$(PORT)"
