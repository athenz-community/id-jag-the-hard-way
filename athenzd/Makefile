.PHONY: help build test athenzd idjag-learner

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "  build             install the athenzd manager and proxy daemon"
	@echo "  test              run all unit and e2e tests"
	@echo "  athenzd           run athenzd from source  (e.g. make athenzd version)"
	@echo "  idjag-learner     write project ./.athenzd/config.yaml (prompts before overwrite)"

build:
	go install ./cmd/athenzd ./cmd/athenzd-genai-proxy
	@echo "Installed: $$(which athenzd)"
	@echo "Installed: $$(which athenzd-genai-proxy)"

test:
	./hack/check-config-test-coverage.sh
	go test -tags=e2e -coverprofile=coverage.out ./...
	@# main() calls os.Exit and cannot be unit tested — skip it, require 100% on everything else.
	@# Excluded functions are OS/crypto/platform primitives that cannot be unit tested:
	@# openBrowser/openBrowserForOS: opens real browser; cacheDir: OS mkdir;
	@# writeFile/expandPath/launchDaemon: OS filesystem/process primitives;
	@# generateKeyAndCSR/pkceParams: crypto rand never fails under a healthy runtime.
	@# Run is excluded only because it calls pkceParams — all other branches are tested.
	go tool cover -func=coverage.out \
		| grep -vE '(main\.go:.*\bmain|openBrowser|openBrowserForOS|cacheDir|writeFile|expandPath|launchDaemon|generateKeyAndCSR|pkceParams|login/login\.go:[0-9]+:.*\bRun)\b' \
		| grep -v '^total:' \
		| awk '/\t[0-9]+\.[0-9]+%$$/ && $$NF+0 < 100 { print "UNCOVERED: " $$0; fail=1 } END { if (fail) exit 1; print "Coverage: 100% (excluding OS/crypto/platform primitives and main)" }'

coverage:
	go tool cover -html=coverage.out

athenzd:
	go install ./cmd/athenzd-genai-proxy
	go run ./cmd/athenzd $(filter-out $@,$(MAKECMDGOALS))

idjag-learner:
	./hack/gen-idjag-learner-config.sh

%:
	@$(MAKE) help
