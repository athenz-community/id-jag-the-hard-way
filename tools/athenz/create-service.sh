#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zms_port=$("$TOOLS_DIR/port.sh" zms)

if [ $# -lt 3 ]; then
  fatal "Usage: $0 <domain> <service_name> <public_key_path>"
fi

domain=$1
service_name=$2
pub_key_path=$3
key_id="v1"

info "Registering Service: ${domain}.${service_name}..."

# Athenz expects the FULL PEM public key text encoded as YBase64.
# YBase64 mapping: + -> . , / -> _ , = -> -
pub_key_y64=$(base64 < "${pub_key_path}" | tr -d '\n' | tr '+/=' '._-')

response=$(curl -s -k --fail-with-body -X PUT "https://localhost:${_zms_port}/zms/v1/domain/${domain}/service/${service_name}" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  -H "Content-Type: application/json" \
  -d '{
    "name": "'"${domain}.${service_name}"'",
    "publicKeys": [
      {
        "id": "'"${key_id}"'",
        "key": "'"${pub_key_y64}"'"
      }
    ]
  }')

if echo "${response}" | grep -q '"code"'; then
  err "ZMS error response:"
  echo "${response}" >&2
  fatal "Failed to register service ${domain}.${service_name}"
fi

ok "Service registered: ${domain}.${service_name}"
