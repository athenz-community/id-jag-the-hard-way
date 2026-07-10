#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zms_port=$("$TOOLS_DIR/port.sh" zms)

if [ $# -lt 3 ]; then
  fatal "Usage: $0 <domain> <role_name> <member_name>"
fi

domain=$1
role_name=$2
member_name=$3

info "Deleting member ${member_name} from role ${domain}:role.${role_name}..." >&2

response_file=$(mktemp)
curl_status=0
http_code=$(curl -s -k -o "${response_file}" -w "%{http_code}" -X DELETE \
  "https://localhost:${_zms_port}/zms/v1/domain/${domain}/role/${role_name}/member/${member_name}" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  --cacert ./athenz_dist/certs/ca.cert.pem) || curl_status=$?
response=$(cat "${response_file}")
rm -f "${response_file}"

if [ "${curl_status}" -ne 0 ] || { [ "${http_code}" != "200" ] && [ "${http_code}" != "204" ] && [ "${http_code}" != "404" ]; }; then
  err "ZMS error response (HTTP ${http_code:-000}, curl ${curl_status}):"
  if [ -n "${response}" ]; then
    echo "${response}" >&2
  else
    err "No response body returned by ZMS."
  fi
  fatal "Failed to delete ${member_name} from ${domain}:role.${role_name}"
fi

ok "Role member deleted or already absent: ${member_name}  →  ${domain}:role.${role_name}" >&2
