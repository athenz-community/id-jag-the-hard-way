#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zts_port=$("$TOOLS_DIR/port.sh" zts)

if [ $# -lt 3 ]; then
  fatal "Usage: $0 <cert_path> <key_path> <client_id>"
fi

cert_path=$1
key_path=$2
client_id=$3
ca_cert="./athenz_dist/certs/ca.cert.pem"
zts_auth_url="https://localhost:${_zts_port}/zts/v1/oauth2/auth"

info "Fetching actor id_token from Athenz ZTS for client: ${client_id}..." >&2

response=$(curl -sS -G "${zts_auth_url}" \
  --cert "${cert_path}" \
  --key "${key_path}" \
  --cacert "${ca_cert}" \
  --data-urlencode "response_type=id_token" \
  --data-urlencode "client_id=${client_id}" \
  --data-urlencode "scope=openid" \
  --data-urlencode "nonce=random_nonce" \
  --data-urlencode "output=json")

token=$(echo "${response}" | jq -r '.id_token // empty')

if [ -z "${token}" ]; then
  err "Failed to fetch actor id_token. ZTS response:" >&2
  echo "${response}" | jq . >&2
  fatal "Actor id_token fetch failed for client: ${client_id}"
fi

ok "Actor id_token issued for client: ${client_id}" >&2
echo "${token}" | jq -R 'split(".") | .[1] | @base64d | fromjson' >&2

echo "${token}"
