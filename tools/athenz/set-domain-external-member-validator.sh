#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zms_port=$("$TOOLS_DIR/port.sh" zms)

if [ $# -lt 2 ]; then
  fatal "Usage: $0 <domain> <validator_class>"
fi

domain=$1
validator_class=$2

info "Setting external member validator for domain ${domain}..."

response_file=$(mktemp)
http_code=$(curl -s -k -o "${response_file}" -w "%{http_code}" -X PUT \
  "https://localhost:${_zms_port}/zms/v1/domain/${domain}/meta/system/externalmembervalidator" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  -H "Content-Type: application/json" \
  -H "Y-Audit-Ref: local external member validator test" \
  -d '{
    "externalMemberValidator": "'"${validator_class}"'"
  }')

response=$(cat "${response_file}")
rm -f "${response_file}"

if [ "${http_code}" -lt 200 ] || [ "${http_code}" -ge 300 ] || echo "${response}" | grep -q '"code"'; then
  err "ZMS error response:"
  echo "${response}" >&2
  fatal "Failed to set external member validator for ${domain} (HTTP ${http_code})"
fi

ok "External member validator set for ${domain}: ${validator_class}"
