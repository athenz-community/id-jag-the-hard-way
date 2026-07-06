#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_keycloak_port=$("$TOOLS_DIR/port.sh" keycloak)
_realm=$("$TOOLS_DIR/config.sh" keycloak realm)
_user_password=$("$TOOLS_DIR/config.sh" keycloak user-password)

if [ $# -lt 4 ]; then
  fatal "Usage: $0 <username> <email> <first_name> <last_name>"
fi

username=$1
email=$2
first_name=$3
last_name=$4
password=$_user_password

info "Fetching Keycloak admin token..."

token=$("${TOOLS_DIR}/keycloak/get-admin-token.sh")

info "Creating user ${username}..."

http_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "http://localhost:${_keycloak_port}/admin/realms/${_realm}/users" \
  -H "Authorization: Bearer ${token}" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"${username}\",
    \"email\": \"${email}\",
    \"firstName\": \"${first_name}\",
    \"lastName\": \"${last_name}\",
    \"enabled\": true
  }")

if [ "$http_code" != "201" ]; then
  fatal "Failed to create user ${username} (HTTP ${http_code})"
fi

info "Looking up UUID for user ${username}..."

user_uuid=$(curl -s \
  "http://localhost:${_keycloak_port}/admin/realms/${_realm}/users?username=${username}&exact=true" \
  -H "Authorization: Bearer ${token}" \
  | sed 's/.*"id":"\([^"]*\)".*/\1/' | head -1)

if [ -z "$user_uuid" ] || [ "$user_uuid" = "null" ]; then
  fatal "Could not find UUID for user ${username}"
fi

info "Setting password for ${username}..."

http_code=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
  "http://localhost:${_keycloak_port}/admin/realms/${_realm}/users/${user_uuid}/reset-password" \
  -H "Authorization: Bearer ${token}" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"password\",
    \"value\": \"${password}\",
    \"temporary\": false
  }")

if [ "$http_code" != "204" ]; then
  fatal "Failed to set password for ${username} (HTTP ${http_code})"
fi

ok "User created: ${username} (${email})"
if [ "${OPEN_UI:-false}" = "true" ]; then
  "${TOOLS_DIR}/open.sh" "http://localhost:${_keycloak_port}/admin/master/console/#/${_realm}/users/${user_uuid}/settings"
fi
