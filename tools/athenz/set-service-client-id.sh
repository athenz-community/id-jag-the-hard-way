#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zms_port=$("$TOOLS_DIR/port.sh" zms)

if [ $# -lt 3 ]; then
  fatal "Usage: $0 <domain> <service_name> <client_id>"
fi

domain=$1
service_name=$2
client_id=$3

if [[ "${service_name}" == *"_"* ]]; then
  fatal "Invalid service name '${service_name}': Athenz service names cannot contain underscores. Remove '_' from the service name, for example '${service_name//_/}'."
fi

info "Setting clientId for ${domain}.${service_name}: ${client_id}..."

response_file=$(mktemp)
curl_status=0
http_code=$(curl -s -k -o "${response_file}" -w "%{http_code}" -X PUT \
  "https://localhost:${_zms_port}/zms/v1/domain/${domain}/service/${service_name}/meta/system/clientId" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  --cacert ./athenz_dist/certs/ca.cert.pem \
  -H "Content-Type: application/json" \
  -H "Y-Audit-Ref: set-service-client-id" \
  -d '{"clientId":"'"${client_id}"'"}') || curl_status=$?
response=$(cat "${response_file}")
rm -f "${response_file}"

if [ "${curl_status}" -ne 0 ] || [ "${http_code:-000}" -lt 200 ] || [ "${http_code:-000}" -ge 300 ] || echo "${response}" | grep -q '"code"'; then
  err "ZMS error response (HTTP ${http_code:-000}, curl ${curl_status}):"
  if [ -n "${response}" ]; then
    echo "${response}" >&2
  else
    err "No response body returned by ZMS."
  fi
  fatal "Failed to set clientId for ${domain}.${service_name}"
fi

ok "clientId set for ${domain}.${service_name}: ${client_id}"
