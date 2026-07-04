PORT ?= 3101
API_SERVER_URL ?= http://localhost:$(shell ../tools/port.sh api-server)
CLIENT_ID ?= org.idjag-ui

build:
	npm run build

kill-local:
	npx kill-port $(PORT)

setup-permissions:
	$(MAKE) setup-permissions-api

setup-permissions-api:
	../tools/setup-permissions.sh ../tools/config/init.yaml

setup-permissions-mcp-hub:
	../tools/setup-permissions.sh ../tools/config/mcp-hub.yaml

setup-permissions-org:
	../tools/setup-permissions.sh ../tools/config/org.yaml

register-client:
	cd .. && ./tools/keycloak/create-client.sh \
		$(CLIENT_ID) \
		"http://localhost:$(PORT)/api/auth/callback/keycloak" \
		"http://localhost:$(PORT)"

get-client-secret:
	cd .. && ./tools/keycloak/create-client-k8s-secret.sh \
		$(CLIENT_ID) default keycloak-$(CLIENT_ID)-secret

local:
	npm install
	../tools/open.sh "http://localhost:$(PORT)" &
	PORT=$(PORT) \
	API_SERVER_URL=$(API_SERVER_URL) \
	npm run dev -- --port $(PORT)
