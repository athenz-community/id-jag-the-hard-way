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
	bash scripts/run-provider.sh "$(RELEASE)" "$(IMAGE)" "$(PORT)"

local:
	npm start
