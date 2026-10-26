export ZMS_URL ZTS_URL
export ATHENZ_CA_CERT ATHENZ_CLIENT_CERT ATHENZ_CLIENT_KEY
export ATHENZ_CONF ATHENZ_POLICY_DIR ATHENZ_ENDPOINTS_FILE

VERSION ?= v1.12.50
RELEASE := v$(patsubst v%,%,$(VERSION))
IMAGE ?= idthw-athenz-nodejs-provider:$(RELEASE)
PORT ?= 18080

.PHONY: build native-build configure endpoints sync install check test local run

build: configure
	docker build --progress=plain --build-arg VERSION="$(RELEASE)" --tag "$(IMAGE)" .

native-build: configure install
	npm run check

configure:
	node scripts/endpoints.cjs configure

endpoints:
	node scripts/endpoints.cjs show

sync:
	bash scripts/sync-policies.sh

install:
	npm run fetch-library
	npm ci --install-links --ignore-scripts --no-audit --no-fund

check:
	npm run check

test:
	npm test

run:
	docker run --rm --pull=never --name "idthw-nodejs-provider-$(RELEASE)" \
		--publish "127.0.0.1:$(PORT):18080" \
		--mount "type=bind,src=$(CURDIR)/.local/athenz.conf,dst=/app/.local/athenz.conf,readonly" \
		--mount "type=bind,src=$(CURDIR)/.local/policies,dst=/app/.local/policies,readonly" \
		"$(IMAGE)"

local:
	npm start
