OPENAI_CLIENT_ATHENZ_GATEWAY_PORT ?= 3101
KEYCLOAK_PORT ?= 34443

PROXY_TARGET ?= http://localhost:8102

local:
	npm install
	PORT=${OPENAI_CLIENT_ATHENZ_GATEWAY_PORT} \
	UPSTREAM_BASE_URL=${PROXY_TARGET} \
	PUBLIC_BASE_URL=http://localhost:${OPENAI_CLIENT_ATHENZ_GATEWAY_PORT} \
	CORS_ORIGINS=http://localhost:3001,http://localhost:3000 \
	DEBUG_HEADERS=true \
	KEYCLOAK_URL=http://localhost:${KEYCLOAK_PORT} \
	KEYCLOAK_REALM=master \
	KEYCLOAK_CLIENT_ID=claude-code \
	npx tsx ./src/index.ts

kill-local:
	npx kill-port ${OPENAI_CLIENT_ATHENZ_GATEWAY_PORT}
