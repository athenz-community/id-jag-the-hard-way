#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_keycloak_port=$("$TOOLS_DIR/port.sh" keycloak)
_realm=$("$TOOLS_DIR/config.sh" keycloak realm)
_admin=$("$TOOLS_DIR/config.sh" keycloak admin)
_admin_password=$("$TOOLS_DIR/config.sh" keycloak admin-password)

if [ $# -lt 3 ]; then
  fatal "Usage: $0 <client_id> <redirect_uri> [web_origin]"
fi

client_id=$1
redirect_uri=$2
web_origin=${3:-$(echo "$redirect_uri" | sed 's|/[^/]*$||' | sed 's|/[^/]*$||')}

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

info "Creating client ${client_id} in realm ${_realm}..."

http_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "http://localhost:${_keycloak_port}/admin/realms/${_realm}/clients" \
  -H "Authorization: Bearer ${token}" \
  -H "Content-Type: application/json" \
  -d "{
    \"clientId\": \"${client_id}\",
    \"name\": \"${client_id}\",
    \"protocol\": \"openid-connect\",
    \"publicClient\": false,
    \"standardFlowEnabled\": true,
    \"directAccessGrantsEnabled\": false,
    \"redirectUris\": [\"${redirect_uri}\"],
    \"webOrigins\": [\"${web_origin}\"]
  }")

if [ "$http_code" != "201" ]; then
  fatal "Failed to create client ${client_id} (HTTP ${http_code})"
fi

client_uuid=$(curl -s \
  "http://localhost:${_keycloak_port}/admin/realms/${_realm}/clients?clientId=${client_id}" \
  -H "Authorization: Bearer ${token}" \
  | sed 's/.*"id":"\([^"]*\)".*/\1/' | head -1)

ok "Client created: ${client_id}"
info "Fetch the generated secret with: tools/keycloak/create-client-k8s-secret.sh"
"${TOOLS_DIR}/open.sh" "http://localhost:${_keycloak_port}/admin/master/console/#/${_realm}/clients/${client_uuid}"
