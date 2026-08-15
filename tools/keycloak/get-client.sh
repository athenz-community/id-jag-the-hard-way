#!/usr/bin/env bash
set -euo pipefail

# List Keycloak clients as formatted JSON. When a clientId is provided, return
# only the exact match as an array, including [] when the client does not exist.

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_keycloak_port=$("${TOOLS_DIR}/port.sh" keycloak)
_realm=$("${TOOLS_DIR}/config.sh" keycloak realm)

if [ "$#" -gt 1 ]; then
  echo "Usage: $0 [client_id]" >&2
  exit 1
fi

_client_id=${1:-}
_admin_token=${KEYCLOAK_ADMIN_TOKEN:-}

if [ -z "${_admin_token}" ]; then
  _admin_token=$("${TOOLS_DIR}/keycloak/get-admin-token.sh")
fi

if [ -n "${_client_id}" ]; then
  curl -fsS \
    -G \
    -H "Authorization: Bearer ${_admin_token}" \
    --data-urlencode "clientId=${_client_id}" \
    "http://localhost:${_keycloak_port}/admin/realms/${_realm}/clients" \
    | jq --arg client_id "${_client_id}" \
      '[.[] | select(.clientId == $client_id)]'
else
  curl -fsS \
    -H "Authorization: Bearer ${_admin_token}" \
    "http://localhost:${_keycloak_port}/admin/realms/${_realm}/clients" \
    | jq
fi
