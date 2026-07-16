#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zms_port=$("$TOOLS_DIR/port.sh" zms)

if [ $# -lt 2 ]; then
  fatal "Usage: $0 <domain> <template> [template ...] [param-key=param-value ...]"
fi

domain=$1
shift

templates=()
params=()

while [ $# -gt 0 ]; do
  arg=$1
  if [[ "${arg}" == *=* ]]; then
    break
  fi

  if [ -z "${arg}" ]; then
    fatal "Template name cannot be empty"
  fi

  templates+=("${arg}")
  shift
done

while [ $# -gt 0 ]; do
  arg=$1

  if [[ "${arg}" != *=* ]]; then
    fatal "Template parameters must be key=value pairs: ${arg}"
  fi

  key=${arg%%=*}
  if [ -z "${key}" ]; then
    fatal "Template parameter key cannot be empty: ${arg}"
  fi

  params+=("${arg}")
  shift
done

if [ "${#templates[@]}" -eq 0 ]; then
  fatal "At least one template name is required"
fi

if ! command -v jq >/dev/null 2>&1; then
  fatal "jq is required to build the ZMS template payload"
fi

templates_json=$(printf '%s\n' "${templates[@]}" | jq -R . | jq -s .)
if [ "${#params[@]}" -gt 0 ]; then
  params_json=$(printf '%s\n' "${params[@]}" | jq -R 'capture("^(?<name>[^=]+)=(?<value>.*)$")' | jq -s .)
else
  params_json='[]'
fi

payload=$(jq -n \
  --argjson templateNames "${templates_json}" \
  --argjson params "${params_json}" \
  '{templateNames: $templateNames} + (if ($params | length) > 0 then {params: $params} else {} end)')

template_label=$(IFS=,; echo "${templates[*]}")

info "Applying Domain Template: ${template_label} -> ${domain}..."

response_file=$(mktemp)
trap 'rm -f "${response_file}"' EXIT

curl_status=0
http_code=$(curl -s -k -o "${response_file}" -w "%{http_code}" -X PUT \
  "https://localhost:${_zms_port}/zms/v1/domain/${domain}/template" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  -H "Content-Type: application/json" \
  -H "Y-Audit-Ref: local set domain template" \
  -d "${payload}") || curl_status=$?
response=$(cat "${response_file}")

if [ "${curl_status}" -ne 0 ] || [ "${http_code:-000}" -lt 200 ] || [ "${http_code:-000}" -ge 300 ] || echo "${response}" | grep -q '"code"'; then
  err "ZMS error response (HTTP ${http_code:-000}, curl ${curl_status}):"
  if [ -n "${response}" ]; then
    echo "${response}" >&2
  else
    err "No response body returned by ZMS."
  fi
  fatal "Failed to apply domain template ${template_label} to ${domain}"
fi

if [ -n "${response}" ]; then
  echo "${response}"
else
  echo "[Template(s) successfully applied to domain]"
fi

ok "Domain template applied: ${template_label} -> ${domain}"
