#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zms_port=$("$TOOLS_DIR/port.sh" zms)

if [ $# -lt 2 ]; then
  fatal "Usage: $0 <parent_domain> <subdomain_name>"
fi

parent=$1
name=$2

info "Creating Subdomain: ${parent}.${name}..."

response=$(curl -s -k -X POST "https://localhost:${_zms_port}/zms/v1/subdomain/${parent}" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  -H "Content-Type: application/json" \
  -d '{
    "parent": "'"${parent}"'",
    "name": "'"${name}"'",
    "adminUsers": ["user.athenz_admin"]
  }')

if echo "${response}" | grep -q '"code"'; then
  err "ZMS error response:"
  echo "${response}" >&2
  fatal "Failed to create subdomain ${parent}.${name}"
fi

ok "Subdomain created: ${parent}.${name}"
