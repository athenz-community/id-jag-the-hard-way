#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zms_port=$("$TOOLS_DIR/port.sh" zms)

usage() {
  printf '%s\n' \
    "Usage: $0 <domain> <group> [--self-renew] [--self-renew-mins <minutes>]"
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
group=$2
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
  --arg name "${domain}:group.${group}" \
  --argjson self_renew "${self_renew_json}" \
  --argjson self_renew_mins "${self_renew_mins_json}" \
  '{name: $name}
    + (if $self_renew == null then {} else {selfRenew: $self_renew} end)
    + (if $self_renew_mins == null then {} else {selfRenewMins: $self_renew_mins} end)')

info "Creating Group: ${domain}:group.${group}..."

response=$(curl -s -k -X PUT "https://localhost:${_zms_port}/zms/v1/domain/${domain}/group/${group}" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  -H "Content-Type: application/json" \
  -H "Y-Audit-Ref: local group test" \
  -d "${request_body}")

if echo "${response}" | grep -q '"code"'; then
  err "ZMS error response:"
  echo "${response}" >&2
  fatal "Failed to create group ${domain}:group.${group}"
fi

ok "Group created: ${domain}:group.${group}"
