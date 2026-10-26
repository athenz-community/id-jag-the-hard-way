#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"

usage() {
  printf '%s\n' \
    "Usage: $0 <cert_path> <key_path> <domain> <role_name> [output_file] [--output <output_file>]" \
    'Requests a 600-second ZTS role token restricted to the named role.' \
    'ZTS_URL overrides the local API base URL (https://localhost:<zts-port>/zts/v1).' \
    'ATHENZ_CA_CERT overrides the IDTHW CA certificate path.' \
    'Progress and response metadata go to stderr; only the token goes to stdout.'
}

if [ "${1:-}" = '-h' ] || [ "${1:-}" = '--help' ]; then
  usage
  exit 0
fi

if [ $# -lt 4 ]; then
  usage >&2
  exit 1
fi

cert_path=$1
key_path=$2
domain=$3
role_name=$4
shift 4
output=""

while [ $# -gt 0 ]; do
  case "$1" in
    --output)
      [ $# -ge 2 ] && [ -n "$2" ] || fatal 'Missing value for --output'
      [ -z "${output}" ] || fatal 'Output file was specified more than once'
      output=$2
      shift 2
      ;;
    -*)
      fatal "Unknown option: $1"
      ;;
    *)
      [ -z "${output}" ] || fatal "Unexpected argument: $1"
      output=$1
      shift
      ;;
  esac
done

[[ "${domain}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || fatal 'Invalid Athenz domain'
[[ "${role_name}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || fatal 'Specify one valid Athenz role name'
[ -z "${output}" ] || [ ! -d "${output}" ] || fatal 'Output path must be a file, not a directory'

if [ -n "${ZTS_URL:-}" ]; then
  zts_url=${ZTS_URL%/}
else
  _zts_port=$("${TOOLS_DIR}/port.sh" zts)
  zts_url="https://localhost:${_zts_port}/zts/v1"
fi
if ! [[ "${zts_url}" =~ ^https?://[^/@?#[:space:]]+(/[^?#[:space:]]*)?/zts/v1$ ]]; then
  fatal 'ZTS_URL must be an HTTP(S) API base URL ending in /zts/v1, without credentials, a query, or a fragment'
fi
ca_cert=${ATHENZ_CA_CERT:-"${TOOLS_DIR}/../athenz_dist/certs/ca.cert.pem"}
request_url="${zts_url}/domain/${domain}/token"

# Keep command substitution usable while leaving progress and curl errors visible.
info "Fetching Role Token for role: ${domain}:role.${role_name}..." >&2
info "ZTS endpoint: ${request_url}" >&2

if ! response=$(curl -sS --connect-timeout 10 --max-time 30 \
  --cacert "${ca_cert}" --cert "${cert_path}" --key "${key_path}" \
  --get \
  --data-urlencode "role=${role_name}" \
  --data-urlencode 'minExpiryTime=600' \
  --data-urlencode 'maxExpiryTime=600' \
  --write-out '\n%{http_code}' \
  "${request_url}"); then
  fatal "Failed to connect to ZTS while requesting ${domain}:role.${role_name}"
fi

http_status=${response##*$'\n'}
response=${response%$'\n'*}

show_response_metadata() {
  if ! printf '%s\n' "${response}" | jq '
    if type == "object" then del(.token) else error("Expected a JSON object") end
  ' >&2; then
    warn 'Could not decode the ZTS response metadata'
  fi
}

if [ "${http_status}" != '200' ]; then
  err "Role-token request failed (HTTP ${http_status}). ZTS response:"
  show_response_metadata
  fatal "Token issuance failed for role: ${domain}:role.${role_name}"
fi

if ! token=$(printf '%s\n' "${response}" | jq -er '
  .token | select(type == "string" and length > 0) | select(test("[\r\n]") | not)
'); then
  err 'ZTS response did not include a nonempty, single-line role token'
  show_response_metadata
  exit 1
fi

ok "Role token issued for role: ${domain}:role.${role_name}" >&2
show_response_metadata

if [ -n "${output}" ]; then
  mkdir -p "$(dirname "${output}")"
  temporary_output=$(mktemp "${output}.XXXXXX")
  trap 'if [ -n "${temporary_output}" ]; then rm -f "${temporary_output}"; fi' EXIT
  chmod 600 "${temporary_output}"
  printf '%s\n' "${token}" > "${temporary_output}"
  mv "${temporary_output}" "${output}"
  temporary_output=""
  ok "Role token saved to: ${output}" >&2
fi

printf '%s\n' "${token}"
