#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zms_port=$("$TOOLS_DIR/port.sh" zms)
UI_OPEN="${UI_OPEN:-false}"

if [ $# -lt 2 ]; then
  fatal "Usage: $0 <domain> <role>"
fi

domain=$1
role=$2

open_role_page() {
  if [ "${UI_OPEN}" != "true" ]; then
    return 0
  fi

  local athenz_ui_port
  athenz_ui_port=$("$TOOLS_DIR/port.sh" athenz-ui)
  "${TOOLS_DIR}/open.sh" "http://localhost:${athenz_ui_port}/domain/${domain}/role"
}

tmp_response=$(mktemp)
trap 'rm -f "${tmp_response}"' EXIT

status=$(curl -s -k -o "${tmp_response}" -w "%{http_code}" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  "https://localhost:${_zms_port}/zms/v1/domain/${domain}/role/${role}")

if [ "${status}" = "200" ]; then
  ok "Role already exists: ${domain}:role.${role}"
  open_role_page
  exit 0
fi

if [ "${status}" != "404" ]; then
  err "ZMS error response:"
  cat "${tmp_response}" >&2
  fatal "Failed to check role ${domain}:role.${role}"
fi

info "Creating Role: ${domain}:role.${role}..."

response=$(curl -s -k -X PUT "https://localhost:${_zms_port}/zms/v1/domain/${domain}/role/${role}" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  -H "Content-Type: application/json" \
  -d '{
    "name": "'"${domain}:role.${role}"'"
  }')

if echo "${response}" | grep -q '"code"'; then
  err "ZMS error response:"
  echo "${response}" >&2
  fatal "Failed to create role ${domain}:role.${role}"
fi

ok "Role created: ${domain}:role.${role}"
open_role_page
