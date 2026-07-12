.PHONY: help test athenzd

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "  test       run all unit and e2e tests"
	@echo "  athenzd    run athenzd  (e.g. make athenzd version)"

test:
	go test -tags=e2e ./...

athenzd:
	go run ./cmd/athenzd $(filter-out $@,$(MAKECMDGOALS))

%:
	@$(MAKE) help
