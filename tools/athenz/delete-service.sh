#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zms_port=$("$TOOLS_DIR/port.sh" zms)

if [ $# -lt 2 ]; then
  fatal "Usage: $0 <domain> <service_name>"
fi

domain=$1
service_name=$2

if [[ "${service_name}" == *"_"* ]]; then
  fatal "Invalid service name '${service_name}': Athenz service names cannot contain underscores. Remove '_' from the service name, for example '${service_name//_/}'."
fi

info "Deleting service ${domain}.${service_name}..." >&2

response_file=$(mktemp)
curl_status=0
http_code=$(curl -s -k -o "${response_file}" -w "%{http_code}" -X DELETE \
  "https://localhost:${_zms_port}/zms/v1/domain/${domain}/service/${service_name}" \
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
  fatal "Failed to delete service ${domain}.${service_name}"
fi

ok "Service deleted or already absent: ${domain}.${service_name}" >&2
