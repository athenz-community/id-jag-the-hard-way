#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zms_port=$("$TOOLS_DIR/port.sh" zms)

if [ $# -lt 2 ]; then
  fatal "Usage: $0 <principal_name> <domain>"
fi

principal_name=$1
domain=$2

info "Showing groups for ${principal_name} in domain ${domain}..."

response=$(curl -s -k -G "https://localhost:${_zms_port}/zms/v1/group" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  --data-urlencode "principal=${principal_name}" \
  --data-urlencode "domain=${domain}")

if echo "${response}" | grep -q '"code"'; then
  err "ZMS error response:"
  echo "${response}" >&2
  fatal "Failed to show groups for ${principal_name}"
fi

if command -v jq >/dev/null 2>&1; then
  echo "${response}" | jq .
else
  echo "${response}"
fi
