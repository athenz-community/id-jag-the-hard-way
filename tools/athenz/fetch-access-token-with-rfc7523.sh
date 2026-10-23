#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"

usage() {
  printf '%s\n' \
    "Usage: $0 <jwt_assertion|-> [scope] [--mode <jwt-bearer|client-assertion>] [--expect <200|400> [expected-error-text]]" \
    "Use - to read one assertion from stdin." \
    "An optional scope is sent as an HTTP parameter; otherwise ZTS uses the assertion's scope." \
    "The default mode is jwt-bearer; client-assertion requires an explicit HTTP scope." \
    "Write the access token to stdout and complete response diagnostics to stderr." \
    "Use --expect 400 with error text to check an intentional rejection; no token is returned."
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

if [ $# -lt 1 ]; then
  usage >&2
  fatal "Provide one RFC 7523 JWT assertion or - for stdin, and an optional scope"
fi

assertion=$1
shift
scope=""
mode=jwt-bearer
expected_http=""
expected_error=""

if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
  scope=$1
  [ -n "${scope}" ] || fatal "The requested scope must not be empty"
  shift
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --mode)
      [ $# -ge 2 ] || fatal "Missing value for --mode"
      mode=$2
      shift 2
      ;;
    --expect)
      [ $# -ge 2 ] || fatal "Missing value for --expect"
      [ -z "${expected_http}" ] || fatal "Specify --expect only once"
      expected_http=$2
      [ -n "${expected_http}" ] || fatal "Expected HTTP status must be 200 or 400"
      shift 2
      if [ "${expected_http}" = "400" ]; then
        [ $# -ge 1 ] && [ -n "$1" ] && [[ "$1" != --* ]] \
          || fatal "HTTP 400 requires expected-error-text"
        expected_error=$1
        shift
      fi
      ;;
    *)
      usage >&2
      fatal "Unknown option: $1"
      ;;
  esac
done

case "${mode}" in
  jwt-bearer)
    grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
    assertion_field=assertion
    ;;
  client-assertion)
    [ -n "${scope}" ] || fatal "client-assertion requires an explicit HTTP scope"
    grant_type=client_credentials
    assertion_field=client_assertion
    ;;
  *) fatal "Choose jwt-bearer or client-assertion for --mode" ;;
esac

case "${expected_http}" in
  ''|200|400) ;;
  *) fatal "Expected HTTP status must be 200 or 400" ;;
esac

if [ "${assertion}" = "-" ]; then
  assertion=""
  IFS= read -r assertion || [ -n "${assertion}" ] || fatal "Provide an assertion on stdin"
fi

[ -n "${assertion}" ] || fatal "The RFC 7523 JWT assertion must not be empty"
command -v curl >/dev/null 2>&1 || fatal "curl is required"
command -v jq >/dev/null 2>&1 || fatal "jq is required"

zts_port=$("${TOOLS_DIR}/port.sh" zts)
[[ "${zts_port}" =~ ^[0-9]+$ ]] || fatal "The configured ZTS port must be numeric"
zts_url="https://localhost:${zts_port}/zts/v1/oauth2/token"

data_args=(
  --data-urlencode "grant_type=${grant_type}"
  --data-urlencode "${assertion_field}@-"
)
if [ -n "${scope}" ]; then
  data_args+=(--data-urlencode "scope=${scope}")
fi
if [ "${mode}" = "client-assertion" ]; then
  data_args+=(--data-urlencode 'client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer')
fi

info "Requesting an access token (${mode})..." >&2
info "Token endpoint: ${zts_url}" >&2
info "Grant type: ${grant_type}" >&2
if [ -n "${scope}" ]; then
  info "Requested scope (HTTP parameter): ${scope}" >&2
else
  info "Using the scope claim from the assertion" >&2
fi
if [ -n "${expected_http}" ]; then
  info "Checking ${mode}; expecting HTTP ${expected_http}..." >&2
fi

if ! response=$(
  printf '%s' "${assertion}" | curl -q -skS --noproxy '*' \
    --connect-timeout 5 --max-time 30 \
    -X POST \
    "${zts_url}" \
    "${data_args[@]}" \
    --write-out $'\n%{http_code}'
); then
  fatal "Could not connect to the ZTS token endpoint"
fi

http_status=${response##*$'\n'}
body=${response%$'\n'*}
[[ "${http_status}" =~ ^[1-5][0-9][0-9]$ ]] || fatal "Missing HTTP status in the response"
if ! printf '%s' "${body}" | jq -e 'type == "object"' >/dev/null 2>&1; then
  fatal "ZTS returned HTTP ${http_status} without a JSON object"
fi

info "ZTS response (HTTP ${http_status}; credential values redacted):" >&2
printf '%s' "${body}" | jq 'with_entries(
  if .key == "access_token" or .key == "refresh_token" or .key == "id_token"
  then .value = "<redacted>"
  else . end
)' >&2

[ "${http_status}" = "${expected_http:-200}" ] \
  || fatal "Expected HTTP ${expected_http:-200}, received ${http_status}"

if [ "${expected_http}" = "400" ]; then
  printf '%s' "${body}" | jq -e --arg expected "${expected_error}" '
    (.access_token == null)
    and (.code == 400)
    and (.message | type == "string" and contains($expected))
  ' >/dev/null || fatal "The rejection did not match the expected assertion validation error"
  ok "${mode} matched the expected result" >&2
  exit 0
fi

printf '%s' "${body}" | jq -e '
  (.access_token | type == "string" and length > 0)
  and ((.token_type // "" | ascii_downcase) == "bearer")
' >/dev/null || fatal "HTTP 200 did not contain a Bearer access token"

access_token=$(printf '%s\n' "${body}" | jq -r '.access_token')

ok "Access token issued (${mode})" >&2
if ! decoded=$(
  printf '%s\n' "${access_token}" \
    | jq -eR '
        def decode: gsub("-"; "+") | gsub("_"; "/") | @base64d | fromjson;
        {header: (split(".")[0] | decode), claims: (split(".")[1] | decode)}
      ' 2>/dev/null
); then
  fatal "Could not decode the JWT access token header and claims"
fi
printf '%s\n' "${decoded}" | jq . >&2
if [ -n "${expected_http}" ]; then
  ok "${mode} matched the expected result" >&2
fi
printf '%s\n' "${access_token}"
