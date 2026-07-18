#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_keycloak_port=$("$TOOLS_DIR/port.sh" keycloak)
_realm=$("$TOOLS_DIR/config.sh" keycloak realm)

if [ $# -lt 1 ]; then
  fatal "Usage: $0 <client_id>"
fi

client_id=$1

info "Fetching Keycloak admin token..." >&2
token=$("${TOOLS_DIR}/keycloak/get-admin-token.sh")

info "Looking up UUID for client ${client_id}..." >&2
client_uuid=$(KEYCLOAK_ADMIN_TOKEN="$token" "${TOOLS_DIR}/keycloak/get-client-uuid.sh" "${client_id}")

if [ -z "$client_uuid" ] || [ "$client_uuid" = "null" ]; then
  fatal "Client not found: ${client_id}"
fi

info "Fetching client secret for ${client_id}..." >&2
client_secret=$(curl -s \
  "http://localhost:${_keycloak_port}/admin/realms/${_realm}/clients/${client_uuid}/client-secret" \
  -H "Authorization: Bearer ${token}" \
  | sed 's/.*"value":"\([^"]*\)".*/\1/')

if [ -z "$client_secret" ] || [ "$client_secret" = "null" ]; then
  fatal "Failed to fetch secret for client ${client_id}"
fi

echo "$client_secret"
