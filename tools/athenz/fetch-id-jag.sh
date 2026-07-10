#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zts_port=$("$TOOLS_DIR/port.sh" zts)

if [ $# -lt 4 ]; then
  fatal "Usage: $0 <cert_path> <key_path> <id_token> <scope>"
fi

cert_path=$1
key_path=$2
id_token=$3
scope=$4
ca_cert="./athenz_dist/certs/ca.cert.pem"
zts_url="https://localhost:${_zts_port}/zts/v1/oauth2/token"
audience="https://athenz-zts-server.athenz:4443/zts/v1"

info "Exchanging id_token for ID_JAG (scope: ${scope})..." >&2

response=$(curl -sS -X POST "${zts_url}" \
  --cert "${cert_path}" \
  --key "${key_path}" \
  --cacert "${ca_cert}" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  --data-urlencode "requested_token_type=urn:ietf:params:oauth:token-type:id-jag" \
  --data-urlencode "subject_token_type=urn:ietf:params:oauth:token-type:id_token" \
  --data-urlencode "subject_token=${id_token}" \
  --data-urlencode "scope=${scope}" \
  --data-urlencode "audience=${audience}")

token=$(echo "${response}" | jq -r '.access_token // empty')

if [ -z "${token}" ]; then
  err "Failed to fetch ID_JAG. ZTS response:" >&2
  echo "${response}" | jq . >&2
  fatal "ID_JAG exchange failed for scope: ${scope}"
fi

ok "ID_JAG issued (scope: ${scope})" >&2
echo "${token}" | jq -R 'split(".") | .[0] | @base64d | fromjson' >&2
echo "${token}" | jq -R 'split(".") | .[1] | @base64d | fromjson' >&2

echo "${token}"
