#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zms_port=$("$TOOLS_DIR/port.sh" zms)
UI_OPEN="${UI_OPEN:-false}"

usage() {
  printf '%s\n' \
    "Usage: $0 <domain> <role> [--self-renew] [--self-renew-mins <minutes>]"
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ $# -lt 2 ]; then
  usage >&2
  exit 1
fi

domain=$1
role=$2
shift 2

self_renew_json=null
self_renew_mins_json=null

while [ $# -gt 0 ]; do
  case "$1" in
    --self-renew)
      self_renew_json=true
      shift
      ;;
    --self-renew-mins)
      [ $# -ge 2 ] || fatal "Missing value for --self-renew-mins"
      self_renew_mins_json=$2
      if ! [[ "${self_renew_mins_json}" =~ ^-?[0-9]+$ ]]; then
        fatal "--self-renew-mins must be an integer: ${self_renew_mins_json}"
      fi
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fatal "Unknown option: $1"
      ;;
  esac
done

request_body=$(jq -nc \
  --arg name "${domain}:role.${role}" \
  --argjson self_renew "${self_renew_json}" \
  --argjson self_renew_mins "${self_renew_mins_json}" \
  '{name: $name}
    + (if $self_renew == null then {} else {selfRenew: $self_renew} end)
    + (if $self_renew_mins == null then {} else {selfRenewMins: $self_renew_mins} end)')

open_role_page() {
  if [ "${UI_OPEN}" != "true" ]; then
    return 0
  fi

  local athenz_ui_port
  athenz_ui_port=$("$TOOLS_DIR/port.sh" athenz-ui)
  "${TOOLS_DIR}/open.sh" "http://localhost:${athenz_ui_port}/domain/${domain}/role"
}

tmp_response=$(mktemp)
trap 'rm -f "${tmp_response}"' EXIT

status=$(curl -s -k -o "${tmp_response}" -w "%{http_code}" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  "https://localhost:${_zms_port}/zms/v1/domain/${domain}/role/${role}")

if [ "${status}" = "200" ]; then
  ok "Role already exists: ${domain}:role.${role}"
  open_role_page
  exit 0
fi

if [ "${status}" != "404" ]; then
  err "ZMS error response:"
  cat "${tmp_response}" >&2
  fatal "Failed to check role ${domain}:role.${role}"
fi

info "Creating Role: ${domain}:role.${role}..."

response=$(curl -s -k -X PUT "https://localhost:${_zms_port}/zms/v1/domain/${domain}/role/${role}" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  -H "Content-Type: application/json" \
  -H "Y-Audit-Ref: local role creation" \
  -d "${request_body}")

if echo "${response}" | grep -q '"code"'; then
  err "ZMS error response:"
  echo "${response}" >&2
  fatal "Failed to create role ${domain}:role.${role}"
fi

ok "Role created: ${domain}:role.${role}"
open_role_page
