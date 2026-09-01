PORT ?= 3103
PUBLIC_BASE_URL ?=
KEYCLOAK_PUBLIC_URL ?=
KEYCLOAK_URL ?= $(KEYCLOAK_PUBLIC_URL)
KEYCLOAK_REALM ?= master
KEYCLOAK_CLIENT_ID ?= mcp-gateway
KEYCLOAK_CLIENT_SECRET ?= mcp-gateway-local-secret
KEYCLOAK_POST_LOGOUT_REDIRECT_URI ?= $(PUBLIC_BASE_URL)/oauth/idp-logout/complete
MCP_HUB_REGISTRY_URL ?= http://127.0.0.1:3102/api/mcp-servers
MCP_HUB_REGISTRY_TOKEN ?= idthw-local-mcp-registry-token
MCP_GATEWAY_ACCESS_SCOPE ?= api:role.mcp-accessor api:role.docs-getter
ATHENZ_ZTS_URL ?= https://localhost:$(shell ../../tools/port.sh zts)/zts/v1
ATHENZ_ZTS_AUDIENCE ?= https://athenz-zts-server.athenz:4443/zts/v1
ATHENZ_CERT_PATH ?= ./certs/mcp-gateway.crt
ATHENZ_KEY_PATH ?= ./certs/mcp-gateway.key
ATHENZ_CA_PATH ?= ./certs/ca.crt
ALLOW_INSECURE_HTTP ?= false
IMAGE ?= mcp-gateway:local

.PHONY: install check test build local build-image register-idp-client

install:
	npm install

check:
	npm run check

test:
	npm test

build:
	npm run build

local: install
	@test -n "$(PUBLIC_BASE_URL)" || (echo "PUBLIC_BASE_URL must be a full gateway URL" >&2; exit 1)
	@test -n "$(KEYCLOAK_PUBLIC_URL)" || (echo "KEYCLOAK_PUBLIC_URL must be a full IdP URL" >&2; exit 1)
	PORT=$(PORT) \
	PUBLIC_BASE_URL=$(PUBLIC_BASE_URL) \
	KEYCLOAK_URL=$(KEYCLOAK_URL) \
	KEYCLOAK_PUBLIC_URL=$(KEYCLOAK_PUBLIC_URL) \
	KEYCLOAK_REALM=$(KEYCLOAK_REALM) \
	KEYCLOAK_CLIENT_ID=$(KEYCLOAK_CLIENT_ID) \
	KEYCLOAK_CLIENT_SECRET=$(KEYCLOAK_CLIENT_SECRET) \
	KEYCLOAK_POST_LOGOUT_REDIRECT_URI=$(KEYCLOAK_POST_LOGOUT_REDIRECT_URI) \
	MCP_HUB_REGISTRY_URL=$(MCP_HUB_REGISTRY_URL) \
	MCP_HUB_REGISTRY_TOKEN=$(MCP_HUB_REGISTRY_TOKEN) \
	MCP_GATEWAY_ACCESS_SCOPE="$(MCP_GATEWAY_ACCESS_SCOPE)" \
	ATHENZ_ZTS_URL=$(ATHENZ_ZTS_URL) \
	ATHENZ_ZTS_AUDIENCE=$(ATHENZ_ZTS_AUDIENCE) \
	ATHENZ_CERT_PATH=$(ATHENZ_CERT_PATH) \
	ATHENZ_KEY_PATH=$(ATHENZ_KEY_PATH) \
	ATHENZ_CA_PATH=$(ATHENZ_CA_PATH) \
	ALLOW_INSECURE_HTTP=$(ALLOW_INSECURE_HTTP) \
	npx tsx src/index.ts

build-image:
	docker build -t $(IMAGE) .

register-idp-client:
	@test -n "$(PUBLIC_BASE_URL)" || (echo "PUBLIC_BASE_URL must be a full gateway URL" >&2; exit 1)
	cd ../.. && \
		KEYCLOAK_CLIENT_SECRET="$(KEYCLOAK_CLIENT_SECRET)" \
		KEYCLOAK_POST_LOGOUT_REDIRECT_URI="$(KEYCLOAK_POST_LOGOUT_REDIRECT_URI)" \
		KEYCLOAK_OPEN_UI=false \
		./tools/keycloak/create-client.sh \
		"$(KEYCLOAK_CLIENT_ID)" \
		"$(PUBLIC_BASE_URL)/oauth/callback" \
		"$(PUBLIC_BASE_URL)" \
		confidential
