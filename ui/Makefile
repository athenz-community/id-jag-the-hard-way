PORT ?= 3101
KEYCLOAK_PORT ?= $(shell ../tools/port.sh keycloak)
API_SERVER_URL ?= http://localhost:$(shell ../tools/port.sh api-server)
KEYCLOAK_REALM ?= master
KEYCLOAK_ADMIN ?= admin
KEYCLOAK_ADMIN_PASSWORD ?= admin
CLIENT_ID ?= org.idjag-ui

build:
	npm run build

kill-local:
	npx kill-port $(PORT)

_TLD      = $(firstword $(subst ., ,$(CLIENT_ID)))
_SUBDOM   = $(lastword $(subst ., ,$(CLIENT_ID)))
CERTS_DIR = certs
KEY_PATH  = $(CERTS_DIR)/$(CLIENT_ID).key
CERT_PATH = $(CERTS_DIR)/$(CLIENT_ID).crt
ZTS_PORT  ?= $(shell ../tools/port.sh zts)

setup-ui-service: create-athenz-domain
	@echo "--- Generating key pair for $(CLIENT_ID) ---"
	mkdir -p $(CERTS_DIR)
	cd .. && ./tools/athenz/create-private-key.sh ui/$(CERTS_DIR)/$(CLIENT_ID)
	@echo "--- Registering service $(_SUBDOM) in domain $(_TLD) ---"
	cd .. && ./tools/athenz/create-service.sh $(_TLD) $(_SUBDOM) ui/$(CERTS_DIR)/$(CLIENT_ID).public.key
	@echo "--- Enabling ZTS cert provider ---"
	cd .. && ./tools/athenz/enable-cert-provider.sh $(_TLD) $(_SUBDOM)
	@echo "--- Fetching X.509 certificate ---"
	sleep 2
	cd .. && ./tools/athenz/fetch-cert.sh $(_TLD) $(_SUBDOM) ui/$(CERTS_DIR)/$(CLIENT_ID).key v1
	@echo "--- Granting jag_exchange permission ---"
	cd .. && ./tools/athenz/add-role-member.sh api jag-exchanging-uis $(CLIENT_ID)
	@echo "Done. Cert saved to $(CERT_PATH)"
	@echo "Next: make register-client && make get-client-secret"

setup-permissions:
	../tools/setup-permissions.sh ../tools/config/init.yaml

create-athenz-domain:
	cd .. && ./tools/athenz/create-tld.sh $(_TLD) && \
		echo "TLD created. Creating subdomain for $(_SUBDOM)..."
	cd .. && ./tools/athenz/create-subdomain.sh $(_TLD) $(_SUBDOM)
	@echo "Done. Next: make -C ui register-client"

register-client:
	@echo "Fetching Keycloak admin token..."
	@TOKEN=$$(curl -s -X POST \
	  "http://localhost:$(KEYCLOAK_PORT)/realms/master/protocol/openid-connect/token" \
	  -d "client_id=admin-cli" \
	  -d "username=$(KEYCLOAK_ADMIN)" \
	  -d "password=$(KEYCLOAK_ADMIN_PASSWORD)" \
	  -d "grant_type=password" \
	  | sed 's/.*"access_token":"\([^"]*\)".*/\1/'); \
	echo "Registering client $(CLIENT_ID)..."; \
	curl -s -X POST \
	  "http://localhost:$(KEYCLOAK_PORT)/admin/realms/$(KEYCLOAK_REALM)/clients" \
	  -H "Authorization: Bearer $$TOKEN" \
	  -H "Content-Type: application/json" \
	  -d '{ \
	    "clientId": "$(CLIENT_ID)", \
	    "name": "$(CLIENT_ID)", \
	    "protocol": "openid-connect", \
	    "publicClient": false, \
	    "standardFlowEnabled": true, \
	    "directAccessGrantsEnabled": false, \
	    "redirectUris": ["http://localhost:$(PORT)/api/auth/callback/keycloak"], \
	    "webOrigins": ["http://localhost:$(PORT)"] \
	  }' \
	  -w "\nHTTP %{http_code}\n" -o /dev/null; \
	echo "Done. Client secret is auto-generated — fetch it with:"; \
	echo "  make -C ui get-client-secret"

get-client-secret:
	@echo "Fetching admin token..."
	@TOKEN=$$(curl -s -X POST \
	  "http://localhost:$(KEYCLOAK_PORT)/realms/master/protocol/openid-connect/token" \
	  -d "client_id=admin-cli" \
	  -d "username=$(KEYCLOAK_ADMIN)" \
	  -d "password=$(KEYCLOAK_ADMIN_PASSWORD)" \
	  -d "grant_type=password" \
	  | sed 's/.*"access_token":"\([^"]*\)".*/\1/'); \
	CLIENT_UUID=$$(curl -s \
	  "http://localhost:$(KEYCLOAK_PORT)/admin/realms/$(KEYCLOAK_REALM)/clients?clientId=$(CLIENT_ID)" \
	  -H "Authorization: Bearer $$TOKEN" \
	  | sed 's/.*"id":"\([^"]*\)".*/\1/'); \
	SECRET=$$(curl -s \
	  "http://localhost:$(KEYCLOAK_PORT)/admin/realms/$(KEYCLOAK_REALM)/clients/$$CLIENT_UUID/client-secret" \
	  -H "Authorization: Bearer $$TOKEN" \
	  | sed 's/.*"value":"\([^"]*\)".*/\1/'); \
	grep -v "^AUTH_KEYCLOAK_ID=\|^AUTH_KEYCLOAK_SECRET=" .env.local > .env.local.tmp; \
	printf "AUTH_KEYCLOAK_ID=$(CLIENT_ID)\nAUTH_KEYCLOAK_SECRET=$$SECRET\n" >> .env.local.tmp; \
	mv .env.local.tmp .env.local; \
	echo "Saved AUTH_KEYCLOAK_ID and AUTH_KEYCLOAK_SECRET to .env.local" \
	echo "Run the server: make -C ui local"

local:
	npm install
	../tools/open.sh "http://localhost:$(PORT)" &
	PORT=$(PORT) \
	API_SERVER_URL=$(API_SERVER_URL) \
	npm run dev -- --port $(PORT)
