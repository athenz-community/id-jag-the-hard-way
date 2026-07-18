#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zms_port=$("$TOOLS_DIR/port.sh" zms)

if [ -z "${1:-}" ]; then
  fatal "Usage: $0 <tld_name>"
fi

tld_name=$1

tmp_response=$(mktemp)
trap 'rm -f "${tmp_response}"' EXIT

curl_status=0
check_status=$(curl -s -k -o "${tmp_response}" -w "%{http_code}" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  "https://localhost:${_zms_port}/zms/v1/domain/${tld_name}") || curl_status=$?

if [ "${check_status}" = "200" ]; then
  ok "TLD already exists: ${tld_name}"
  exit 0
fi

if [ "${curl_status}" -ne 0 ] || [ "${check_status}" != "404" ]; then
  err "ZMS error response (HTTP ${check_status:-000}, curl ${curl_status}):"
  if [ -s "${tmp_response}" ]; then
    cat "${tmp_response}" >&2
  else
    err "No response body returned by ZMS."
  fi
  fatal "Failed to check TLD ${tld_name}"
fi

info "Creating TLD: ${tld_name}..."

curl_status=0
http_code=$(curl -s -k -o "${tmp_response}" -w "%{http_code}" -X POST "https://localhost:${_zms_port}/zms/v1/domain" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  -H "Content-Type: application/json" \
  -d '{
    "name": "'"${tld_name}"'",
    "description": "TLD for '"${tld_name}"'",
    "org": "ajkimkim",
    "enabled": true,
    "adminUsers": ["user.athenz_admin"]
  }') || curl_status=$?
response=$(cat "${tmp_response}")

if [ "${http_code:-000}" = "409" ] || echo "${response}" | grep -qi "already exists"; then
  ok "TLD already exists: ${tld_name}"
  exit 0
fi

if [ "${curl_status}" -ne 0 ] || [ "${http_code:-000}" -lt 200 ] || [ "${http_code:-000}" -ge 300 ] || echo "${response}" | grep -q '"code"'; then
  err "ZMS error response (HTTP ${http_code:-000}, curl ${curl_status}):"
  if [ -n "${response}" ]; then
    echo "${response}" >&2
  else
    err "No response body returned by ZMS."
  fi
  fatal "Failed to create TLD ${tld_name}"
fi

ok "TLD created: ${tld_name}"
