.PHONY: help test athenzd

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "  test              run all unit and e2e tests"
	@echo "  athenzd           run athenzd  (e.g. make athenzd version)"
	@echo "  idjag-learner     generate athenzd.idjag-learner.yaml from tools/port.sh"

test: idjag-learner
	./hack/check-config-test-coverage.sh
	go test -tags=e2e -coverprofile=coverage.out ./...
	@# main() calls os.Exit and cannot be unit tested — skip it, require 100% on everything else.
	go tool cover -func=coverage.out \
		| grep -v '/main\.go:.*\bmain\b' \
		| grep -v '^total:' \
		| awk '/\t[0-9]+\.[0-9]+%$$/ && $$NF+0 < 100 { print "UNCOVERED: " $$0; fail=1 } END { if (fail) exit 1; print "Coverage: 100% (excluding main)" }'

coverage:
	go tool cover -html=coverage.out

athenzd:
	go run ./cmd/athenzd $(filter-out $@,$(MAKECMDGOALS))

idjag-learner:
	./hack/gen-idjag-learner-config.sh

%:
	@$(MAKE) help
