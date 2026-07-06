#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_keycloak_port=$("$TOOLS_DIR/port.sh" keycloak)
_realm=$("$TOOLS_DIR/config.sh" keycloak realm)

if [ $# -lt 2 ]; then
  fatal "Usage: $0 <client_id> <redirect_uri> [web_origin] [public|confidential]"
fi

client_id=$1
redirect_uri=$2
web_origin=${3:-$(echo "$redirect_uri" | sed 's|/[^/]*$||' | sed 's|/[^/]*$||')}
client_type=${4:-confidential}

case "$client_type" in
  public)
    public_client=true
    ;;
  confidential)
    public_client=false
    ;;
  *)
    fatal "Invalid client type: ${client_type}. Use public or confidential."
    ;;
esac

info "Fetching Keycloak admin token..."

token=$("${TOOLS_DIR}/keycloak/get-admin-token.sh")

client_payload=$(
  cat <<EOF
{
  "clientId": "${client_id}",
  "name": "${client_id}",
  "protocol": "openid-connect",
  "publicClient": ${public_client},
  "standardFlowEnabled": true,
  "directAccessGrantsEnabled": false,
  "redirectUris": ["${redirect_uri}"],
  "webOrigins": ["${web_origin}"]
}
EOF
)

info "Looking up client ${client_id} in realm ${_realm}..."

client_uuid=$(KEYCLOAK_ADMIN_TOKEN="$token" "${TOOLS_DIR}/keycloak/get-client-uuid.sh" "${client_id}")

if [ -n "$client_uuid" ]; then
  info "Updating existing client ${client_id}..."

  http_code=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
    "http://localhost:${_keycloak_port}/admin/realms/${_realm}/clients/${client_uuid}" \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "${client_payload}")

  if [ "$http_code" != "204" ]; then
    fatal "Failed to update client ${client_id} (HTTP ${http_code})"
  fi

  ok "Client updated: ${client_id}"
else
  info "Creating client ${client_id}..."

  http_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    "http://localhost:${_keycloak_port}/admin/realms/${_realm}/clients" \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "${client_payload}")

  if [ "$http_code" != "201" ]; then
    fatal "Failed to create client ${client_id} (HTTP ${http_code})"
  fi

  client_uuid=$(KEYCLOAK_ADMIN_TOKEN="$token" "${TOOLS_DIR}/keycloak/get-client-uuid.sh" "${client_id}")
  ok "Client created: ${client_id}"
fi

if [ "$client_type" = "confidential" ]; then
  info "Fetch the generated secret with: tools/keycloak/create-client-k8s-secret.sh"
fi

if [ "${KEYCLOAK_OPEN_UI:-true}" = "true" ]; then
  "${TOOLS_DIR}/open.sh" "http://localhost:${_keycloak_port}/admin/master/console/#/${_realm}/clients/${client_uuid}/settings"
fi
