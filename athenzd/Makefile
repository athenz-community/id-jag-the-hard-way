.PHONY: help build test athenzd idjag-learner

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "  build             compile and install athenzd to ~/go/bin"
	@echo "  test              run all unit and e2e tests"
	@echo "  athenzd           run athenzd without installing  (e.g. make athenzd version)"
	@echo "  idjag-learner     write project ./.athenzd/config.yaml (prompts before overwrite; FORCE=1 to skip)"

build:
	go install ./cmd/athenzd
	@echo "Installed: $$(which athenzd)"

test:
	FORCE=1 ./hack/gen-idjag-learner-config.sh >/dev/null
	./hack/check-config-test-coverage.sh
	go test -tags=e2e -coverprofile=coverage.out ./...
	@# main() calls os.Exit and cannot be unit tested — skip it, require 100% on everything else.
	@# Excluded functions are OS/crypto/platform primitives that cannot be unit tested:
	@# openBrowser/openBrowserForOS: opens real browser; cacheDir: OS mkdir;
	@# writeFile/pkceParams: JSON marshal/crypto rand never fail on valid input.
	@# Run is excluded only because it calls pkceParams — all other branches are tested.
	go tool cover -func=coverage.out \
		| grep -vE '(main\.go:.*\bmain|openBrowser|openBrowserForOS|cacheDir|writeFile|pkceParams|login/login\.go:[0-9]+:.*\bRun)\b' \
		| grep -v '^total:' \
		| awk '/\t[0-9]+\.[0-9]+%$$/ && $$NF+0 < 100 { print "UNCOVERED: " $$0; fail=1 } END { if (fail) exit 1; print "Coverage: 100% (excluding OS/crypto/platform primitives and main)" }'

coverage:
	go tool cover -html=coverage.out

athenzd:
	go run ./cmd/athenzd $(filter-out $@,$(MAKECMDGOALS))

idjag-learner:
	./hack/gen-idjag-learner-config.sh

%:
	@$(MAKE) help
