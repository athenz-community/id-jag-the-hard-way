#!/usr/bin/env bash
set -euo pipefail

# Print the current Keycloak realm's live OpenID Connect discovery document.
#
# This reads Keycloak itself, not the static values in tools/config.yaml. It is
# useful for checking the issuer, endpoints, supported grants, authentication
# methods, and preview-feature metadata exposed by the running server.

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_keycloak_port=$("$TOOLS_DIR/port.sh" keycloak)
_realm=$("$TOOLS_DIR/config.sh" keycloak realm)

curl -fsS \
  "http://localhost:${_keycloak_port}/realms/${_realm}/.well-known/openid-configuration" \
  | jq
