#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zms_port=$("$TOOLS_DIR/port.sh" zms)

if [ -z "${1:-}" ]; then
  fatal "Usage: $0 <tld_name>"
fi

tld_name=$1

info "Creating TLD: ${tld_name}..."

response=$(curl -s -k -X POST "https://localhost:${_zms_port}/zms/v1/domain" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  -H "Content-Type: application/json" \
  -d '{
    "name": "'"${tld_name}"'",
    "description": "TLD for '"${tld_name}"'",
    "org": "ajkimkim",
    "enabled": true,
    "adminUsers": ["user.athenz_admin"]
  }')

if echo "${response}" | grep -q '"code"'; then
  err "ZMS error response:"
  echo "${response}" >&2
  fatal "Failed to create TLD ${tld_name}"
fi

ok "TLD created: ${tld_name}"
