#!/usr/bin/env bash
set -euo pipefail

# Print a Keycloak admin access token to stdout.
#
# This helper centralizes the admin-token flow used by the Keycloak tooling.
# It uses the tutorial's configured admin username/password with Keycloak's
# built-in admin-cli client, then prints only the access token so callers can
# safely use command substitution:
#
#   token=$(./tools/keycloak/get-admin-token.sh)
#
# Keep diagnostics on stderr. Anything printed to stdout becomes part of the
# captured token for callers.

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_keycloak_port=$("$TOOLS_DIR/port.sh" keycloak)
_admin=$("$TOOLS_DIR/config.sh" keycloak admin)
_admin_password=$("$TOOLS_DIR/config.sh" keycloak admin-password)

token=$(curl -s -X POST \
  "http://localhost:${_keycloak_port}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" \
  -d "username=${_admin}" \
  -d "password=${_admin_password}" \
  -d "grant_type=password" \
  | sed 's/.*"access_token":"\([^"]*\)".*/\1/')

if [ -z "$token" ] || [ "$token" = "null" ]; then
  echo "Failed to obtain Keycloak admin token. Check keycloak.admin / keycloak.admin-password in tools/config.yaml." >&2
  exit 1
fi

printf '%s\n' "$token"
