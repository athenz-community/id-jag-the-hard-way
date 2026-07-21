PORT ?= 3102
OPEN_UI ?= false
AUTH_SECRET ?= idthw-mcp-hub-local-auth-secret
MCP_HUB_IDP_NAME ?= Keycloak
MCP_HUB_IDP_ISSUER ?= http://localhost:$(shell ../tools/port.sh keycloak)/realms/master
MCP_HUB_IDP_PUBLIC_ISSUER ?= $(MCP_HUB_IDP_ISSUER)
MCP_HUB_IDP_CLIENT_ID ?= mcp-hub.hub-ui
MCP_HUB_IDP_CLIENT_SECRET ?= mcp-hub-local-secret
MCP_HUB_ZTS_URL ?= https://localhost:$(shell ../tools/port.sh zts)/zts/v1
GENAI_PROXY_URL ?= http://127.0.0.1:$(shell ../tools/port.sh genai-proxy)

.PHONY: build local register-idp-client

build:
	npm install
	npm run build
	cp -R public .next/standalone/
	mkdir -p .next/standalone/.next
	cp -R .next/static .next/standalone/.next/

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

local: build
	if [ "$(OPEN_UI)" = "true" ]; then (../tools/open.sh "http://localhost:$(PORT)" &); fi
	PORT="$(PORT)" \
	HOSTNAME="127.0.0.1" \
	AUTH_SECRET="$(AUTH_SECRET)" \
	MCP_HUB_IDP_NAME="$(MCP_HUB_IDP_NAME)" \
	MCP_HUB_IDP_ISSUER="$(MCP_HUB_IDP_ISSUER)" \
	MCP_HUB_IDP_PUBLIC_ISSUER="$(MCP_HUB_IDP_PUBLIC_ISSUER)" \
	MCP_HUB_IDP_CLIENT_ID="$(MCP_HUB_IDP_CLIENT_ID)" \
	MCP_HUB_IDP_CLIENT_SECRET="$(MCP_HUB_IDP_CLIENT_SECRET)" \
	MCP_HUB_ZTS_URL="$(MCP_HUB_ZTS_URL)" \
	GENAI_PROXY_URL="$(GENAI_PROXY_URL)" \
	node .next/standalone/server.js
