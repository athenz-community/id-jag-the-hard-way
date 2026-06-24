#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_keycloak_port=$("$TOOLS_DIR/port.sh" keycloak)
_realm=$("$TOOLS_DIR/config.sh" keycloak realm)
_admin=$("$TOOLS_DIR/config.sh" keycloak admin)
_admin_password=$("$TOOLS_DIR/config.sh" keycloak admin-password)

if [ $# -lt 1 ]; then
  fatal "Usage: $0 <lifespan_seconds>"
fi

lifespan_seconds=$1

info "Fetching Keycloak admin token..."

token=$(curl -s -X POST \
  "http://localhost:${_keycloak_port}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" \
  -d "username=${_admin}" \
  -d "password=${_admin_password}" \
  -d "grant_type=password" \
  | sed 's/.*"access_token":"\([^"]*\)".*/\1/')

if [ -z "$token" ] || [ "$token" = "null" ]; then
  fatal "Failed to obtain admin token — check keycloak.admin / keycloak.admin-password in tools/config.yaml"
fi

info "Setting access token lifespan to ${lifespan_seconds}s in realm ${_realm}..."

http_code=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
  "http://localhost:${_keycloak_port}/admin/realms/${_realm}" \
  -H "Authorization: Bearer ${token}" \
  -H "Content-Type: application/json" \
  -d "{\"accessTokenLifespan\": ${lifespan_seconds}}")

if [ "$http_code" != "204" ]; then
  fatal "Failed to update token lifespan (HTTP ${http_code})"
fi

ok "Access token lifespan set to ${lifespan_seconds}s ($(( lifespan_seconds / 3600 ))h)"
"${TOOLS_DIR}/open.sh" "http://localhost:${_keycloak_port}/admin/master/console/#/${_realm}/realm-settings/tokens"
