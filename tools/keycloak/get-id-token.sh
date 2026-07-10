#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_keycloak_port=$("$TOOLS_DIR/port.sh" keycloak)
_user_password=$("$TOOLS_DIR/config.sh" keycloak user-password)

if [ $# -lt 2 ]; then
  fatal "Usage: $0 <client_id> <client_secret> [username]"
fi

client_id=$1
client_secret=$2
username=${3:-idjag-learner}

info "Fetching id_token from Keycloak for Keycloak username: ${username}, client: ${client_id}..." >&2

response=$(curl -s -X POST \
  "http://localhost:${_keycloak_port}/realms/master/protocol/openid-connect/token" \
  -d "client_id=${client_id}" \
  -d "client_secret=${client_secret}" \
  -d "username=${username}" \
  -d "password=${_user_password}" \
  -d "scope=openid email profile" \
  -d "grant_type=password")

token=$(echo "${response}" | jq -r '.id_token // empty')

if [ -z "${token}" ]; then
  err "Failed to fetch id_token. Keycloak response:" >&2
  echo "${response}" | jq . >&2
  fatal "id_token fetch failed for client: ${client_id}"
fi

ok "id_token issued for Keycloak username: ${username}" >&2
echo "${token}" | jq -R 'split(".") | .[0] | @base64d | fromjson' >&2
echo "${token}" | jq -R 'split(".") | .[1] | @base64d | fromjson' >&2

echo "${token}"
