.PHONY: help athenzv athenz-vup athenz-version athenz-verison test-athenz-version fix-zts-key-id kid mcp-solution-templates

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "  athenzv                     show running Athenz versions and source commit SHAs"
	@echo "  athenz-vup [VERSION=1.12.48] switch local Athenz (default: latest stable tag)"
	@echo "                              add DRY_RUN=true to preview or REBUILD=true to build"
	@echo "  fix-zts-key-id (alias: kid) register the current ZMS pod key ID, then restart ZTS"
	@echo "  mcp-solution-templates       load MCP Hub custom solution templates, then restart ZMS"

athenzv:
	@./tools/athenz/athenz-version-verifier.sh --show

athenz-vup: export ATHENZ_VERSION := $(if $(VERSION),$(VERSION),latest)
athenz-vup: export DRY_RUN := $(DRY_RUN)
athenz-vup: export REBUILD := $(REBUILD)
athenz-vup:
	@./tools/athenz/set-athenz-version.sh "$${ATHENZ_VERSION}"

athenz-version athenz-verison: athenz-vup

test-athenz-version:
	python3 -B -m unittest discover -s tools/athenz/tests -p 'test_athenz_version*.py'

fix-zts-key-id:
	@_zms_pod="$$(kubectl -n athenz get pod -l app.kubernetes.io/name=athenz-zms-server -o jsonpath='{.items[0].metadata.name}')" && \
	test -n "$${_zms_pod}" && \
	kubectl -n athenz exec -i deployment/athenz-cli -- sh -c "cat >/tmp/zms.public.pem && zms-cli -z https://athenz-zms-server.athenz:4443/zms/v1 -key /var/run/athenz/athenz_admin.private.pem -cert /var/run/athenz/athenz_admin.cert.pem -d sys.auth add-public-key zms $${_zms_pod} /tmp/zms.public.pem" < athenz_dist/kubernetes/athenz-zms-server/kustomize/keys/zms.public.pem && \
	kubectl -n athenz rollout restart deployment/athenz-zts-server && \
	kubectl -n athenz rollout status deployment/athenz-zts-server

kid: fix-zts-key-id

mcp-solution-templates:
	@./tools/athenz/apply-mcp-solution-templates.sh
