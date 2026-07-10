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
  ok "Client already absent: ${client_id}" >&2
  exit 0
fi

info "Deleting client ${client_id}..." >&2

http_code=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
  "http://localhost:${_keycloak_port}/admin/realms/${_realm}/clients/${client_uuid}" \
  -H "Authorization: Bearer ${token}")

if [ "$http_code" != "204" ]; then
  fatal "Failed to delete client ${client_id} (HTTP ${http_code})"
fi

ok "Client deleted: ${client_id}" >&2
