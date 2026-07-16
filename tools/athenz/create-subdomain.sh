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

subdomain="${parent}.${name}"

response_file=$(mktemp)
trap 'rm -f "${response_file}"' EXIT

curl_status=0
check_status=$(curl -s -k -o "${response_file}" -w "%{http_code}" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  "https://localhost:${_zms_port}/zms/v1/domain/${subdomain}") || curl_status=$?

if [ "${check_status}" = "200" ]; then
  ok "Subdomain already exists: ${subdomain}"
  exit 0
fi

if [ "${curl_status}" -ne 0 ] || [ "${check_status}" != "404" ]; then
  err "ZMS error response (HTTP ${check_status:-000}, curl ${curl_status}):"
  if [ -s "${response_file}" ]; then
    cat "${response_file}" >&2
  else
    err "No response body returned by ZMS."
  fi
  fatal "Failed to check subdomain ${subdomain}"
fi

info "Creating Subdomain: ${subdomain}..."

curl_status=0
http_code=$(curl -s -k -o "${response_file}" -w "%{http_code}" -X POST "https://localhost:${_zms_port}/zms/v1/subdomain/${parent}" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  -H "Content-Type: application/json" \
  -d '{
    "parent": "'"${parent}"'",
    "name": "'"${name}"'",
    "adminUsers": ["user.athenz_admin"]
  }') || curl_status=$?
response=$(cat "${response_file}")

if [ "${http_code:-000}" = "409" ] || echo "${response}" | grep -qi "already exists"; then
  ok "Subdomain already exists: ${subdomain}"
  exit 0
fi

if [ "${curl_status}" -ne 0 ] || [ "${http_code:-000}" -lt 200 ] || [ "${http_code:-000}" -ge 300 ] || echo "${response}" | grep -q '"code"'; then
  err "ZMS error response (HTTP ${http_code:-000}, curl ${curl_status}):"
  if [ -n "${response}" ]; then
    echo "${response}" >&2
  else
    err "No response body returned by ZMS."
  fi
  fatal "Failed to create subdomain ${subdomain}"
fi

ok "Subdomain created: ${subdomain}"
