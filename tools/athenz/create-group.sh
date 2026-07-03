#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zms_port=$("$TOOLS_DIR/port.sh" zms)

if [ $# -lt 2 ]; then
  fatal "Usage: $0 <domain> <group>"
fi

domain=$1
group=$2

info "Creating Group: ${domain}:group.${group}..."

response=$(curl -s -k -X PUT "https://localhost:${_zms_port}/zms/v1/domain/${domain}/group/${group}" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  -H "Content-Type: application/json" \
  -H "Y-Audit-Ref: local group test" \
  -d '{
    "name": "'"${domain}:group.${group}"'"
  }')

if echo "${response}" | grep -q '"code"'; then
  err "ZMS error response:"
  echo "${response}" >&2
  fatal "Failed to create group ${domain}:group.${group}"
fi

ok "Group created: ${domain}:group.${group}"
