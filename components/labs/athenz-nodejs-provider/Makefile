.PHONY: build install check test local

build: install
	npm run check

install:
	npm run fetch-library
	npm ci --install-links --ignore-scripts --no-audit --no-fund

check:
	npm run check

test:
	npm test

local:
	npm start
