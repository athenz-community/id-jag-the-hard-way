#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zms_port=$("${TOOLS_DIR}/port.sh" zms)

if [ $# -lt 1 ]; then
  fatal "Usage: $0 <domain>"
fi

domain=$1

info "Showing domain ${domain}..." >&2

response_file=$(mktemp)
trap 'rm -f "${response_file}"' EXIT

curl_status=0
http_code=$(curl -sS -o "${response_file}" -w '%{http_code}' \
  "https://localhost:${_zms_port}/zms/v1/domain/${domain}" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  --cacert ./athenz_dist/certs/ca.cert.pem) || curl_status=$?
response=$(cat "${response_file}")

if [ "${curl_status}" -ne 0 ] || [ "${http_code:-000}" != "200" ]; then
  err "ZMS error response (HTTP ${http_code:-000}, curl ${curl_status}):"
  if [ -n "${response}" ]; then
    echo "${response}" >&2
  else
    err "No response body returned by ZMS."
  fi
  fatal "Failed to show domain ${domain}"
fi

if command -v jq >/dev/null 2>&1; then
  echo "${response}" | jq .
else
  echo "${response}"
fi
