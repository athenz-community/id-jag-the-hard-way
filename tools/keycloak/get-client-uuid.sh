#!/usr/bin/env bash
set -euo pipefail

# Print the internal Keycloak UUID for a clientId.
#
# Keycloak's human-readable clientId (for example, "athenz-usercert") is not
# the identifier used by update/secret Admin API endpoints. Those endpoints
# require Keycloak's internal UUID. This helper centralizes that lookup.
#
# Usage:
#
#   ./tools/keycloak/get-client-uuid.sh <client_id>
#
# By default, this helper fetches its own admin token. Callers that already have
# one can avoid an extra token request by passing it as KEYCLOAK_ADMIN_TOKEN:
#
#   KEYCLOAK_ADMIN_TOKEN="$token" ./tools/keycloak/get-client-uuid.sh <client_id>
#
# It prints only the UUID to stdout. If the client does not exist, stdout is
# empty and the exit code is still 0, so callers can choose whether "missing" is
# an error or a create-new-client path.

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_keycloak_port=$("$TOOLS_DIR/port.sh" keycloak)
_realm=$("$TOOLS_DIR/config.sh" keycloak realm)

if [ $# -lt 1 ]; then
  echo "Usage: $0 <client_id>" >&2
  exit 1
fi

client_id=$1
token=${KEYCLOAK_ADMIN_TOKEN:-}

if [ -z "$token" ]; then
  token=$("${TOOLS_DIR}/keycloak/get-admin-token.sh")
fi

client_uuid=$(curl -s \
  "http://localhost:${_keycloak_port}/admin/realms/${_realm}/clients?clientId=${client_id}" \
  -H "Authorization: Bearer ${token}" \
  | sed 's/.*"id":"\([^"]*\)".*/\1/' | head -1)

if [ "$client_uuid" = "[]" ] || [ "$client_uuid" = "null" ]; then
  client_uuid=""
fi

printf '%s\n' "$client_uuid"
