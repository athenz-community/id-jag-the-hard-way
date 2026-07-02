#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zms_port=$("$TOOLS_DIR/port.sh" zms)
_athenz_ui_port=$("$TOOLS_DIR/port.sh" athenz-ui)

if [ $# -lt 2 ]; then
  fatal "Usage: $0 <domain> <service_name> [public_key_path]"
fi

domain=$1
service_name=$2
pub_key_path=${3:-}
key_id="v1"

if [[ "${service_name}" == *"_"* ]]; then
  fatal "Invalid service name '${service_name}': Athenz service names cannot contain underscores. Remove '_' from the service name, for example '${service_name//_/}'."
fi

info "Registering Service: ${domain}.${service_name}..."

open_service_page() {
  "${TOOLS_DIR}/open.sh" "http://localhost:${_athenz_ui_port}/domain/${domain}/service"
}

if [ -z "${pub_key_path}" ]; then
  if kubectl -n athenz exec -i deploy/athenz-cli -- \
    zms-cli \
      -i user.athenz_admin \
      -z https://athenz-zms-server.athenz:4443/zms/v1 \
      -key /var/run/athenz/athenz_admin.private.pem \
      -cert /var/run/athenz/athenz_admin.cert.pem \
      -d "${domain}" \
      show-service "${service_name}" >/dev/null 2>&1; then
    ok "Service already registered: ${domain}.${service_name}"
    open_service_page
    exit 0
  fi

  if ! response=$(kubectl -n athenz exec -i deploy/athenz-cli -- \
    zms-cli \
      -i user.athenz_admin \
      -z https://athenz-zms-server.athenz:4443/zms/v1 \
      -key /var/run/athenz/athenz_admin.private.pem \
      -cert /var/run/athenz/athenz_admin.cert.pem \
      -d "${domain}" \
      add-service "${service_name}" 2>&1); then
    err "ZMS CLI error response:"
    echo "${response}" >&2
    fatal "Failed to register service ${domain}.${service_name}"
  fi

  ok "Service registered: ${domain}.${service_name}"
  open_service_page
  exit 0
fi

if [ ! -f "${pub_key_path}" ]; then
  fatal "Public key file not found: ${pub_key_path}"
fi

if [ -n "${pub_key_path}" ]; then
  # Athenz expects the FULL PEM public key text encoded as YBase64.
  # YBase64 mapping: + -> . , / -> _ , = -> -
  pub_key_y64=$(base64 < "${pub_key_path}" | tr -d '\n' | tr '+/=' '._-')

  payload='{
    "name": "'"${domain}.${service_name}"'",
    "publicKeys": [
      {
        "id": "'"${key_id}"'",
        "key": "'"${pub_key_y64}"'"
      }
    ]
  }'
fi

response_file=$(mktemp)
curl_status=0
http_code=$(curl -s -k -o "${response_file}" -w "%{http_code}" -X PUT "https://localhost:${_zms_port}/zms/v1/domain/${domain}/service/${service_name}" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  -H "Content-Type: application/json" \
  -d "${payload}") || curl_status=$?
response=$(cat "${response_file}")
rm -f "${response_file}"

if [ "${curl_status}" -ne 0 ] || [ "${http_code:-000}" -lt 200 ] || [ "${http_code:-000}" -ge 300 ] || echo "${response}" | grep -q '"code"'; then
  err "ZMS error response (HTTP ${http_code:-000}, curl ${curl_status}):"
  if [ -n "${response}" ]; then
    echo "${response}" >&2
  else
    err "No response body returned by ZMS."
  fi
  fatal "Failed to register service ${domain}.${service_name}"
fi

ok "Service registered: ${domain}.${service_name}"
open_service_page
