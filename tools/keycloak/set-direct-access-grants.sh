#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_keycloak_port=$("$TOOLS_DIR/port.sh" keycloak)
_realm=$("$TOOLS_DIR/config.sh" keycloak realm)

if [ $# -lt 1 ]; then
  fatal "Usage: $0 <client_id> [true|false]"
fi

client_id=$1
enabled=${2:-true}

case "${enabled}" in
  true|false)
    ;;
  *)
    fatal "Invalid direct access grants value: ${enabled}. Use true or false."
    ;;
esac

info "Fetching Keycloak admin token..." >&2
token=$("${TOOLS_DIR}/keycloak/get-admin-token.sh")

info "Looking up UUID for client ${client_id}..." >&2
client_uuid=$(KEYCLOAK_ADMIN_TOKEN="$token" "${TOOLS_DIR}/keycloak/get-client-uuid.sh" "${client_id}")

if [ -z "${client_uuid}" ] || [ "${client_uuid}" = "null" ]; then
  fatal "Client not found: ${client_id}"
fi

info "Fetching client ${client_id}..." >&2
client_json=$(curl -s \
  "http://localhost:${_keycloak_port}/admin/realms/${_realm}/clients/${client_uuid}" \
  -H "Authorization: Bearer ${token}")

updated_client_json=$(echo "${client_json}" | jq --argjson enabled "${enabled}" '.directAccessGrantsEnabled = $enabled')

info "Setting Direct Access Grants for ${client_id}: ${enabled}..." >&2
http_code=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
  "http://localhost:${_keycloak_port}/admin/realms/${_realm}/clients/${client_uuid}" \
  -H "Authorization: Bearer ${token}" \
  -H "Content-Type: application/json" \
  -d "${updated_client_json}")

if [ "${http_code}" != "204" ]; then
  fatal "Failed to set Direct Access Grants for ${client_id} (HTTP ${http_code})"
fi

ok "Direct Access Grants set for ${client_id}: ${enabled}" >&2
