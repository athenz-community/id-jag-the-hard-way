#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zts_port=$("$TOOLS_DIR/port.sh" zts)

if [ $# -lt 4 ]; then
  fatal "Usage: $0 <cert_path> <key_path> <id_jag_token> <scope> [output_file] [--actor <actor>] [--output <output_file>]"
fi

cert_path=$1
key_path=$2
id_jag_token=$3
scope=$4
shift 4

output=""
actor=""
ca_cert="./athenz_dist/certs/ca.cert.pem"
zts_url="https://localhost:${_zts_port}/zts/v1/oauth2/token"

while [ $# -gt 0 ]; do
  case "$1" in
    --actor)
      [ $# -ge 2 ] || fatal "Missing value for --actor"
      actor=$2
      shift 2
      ;;
    --output)
      [ $# -ge 2 ] || fatal "Missing value for --output"
      output=$2
      shift 2
      ;;
    -*)
      fatal "Unknown option: $1"
      ;;
    *)
      if [ -n "${output}" ]; then
        fatal "Unexpected argument: $1"
      fi
      output=$1
      shift
      ;;
  esac
done

info "Fetching Access Token with ID_JAG for scope: ${scope}..." >&2

curl_args=(
  -sS
  -X POST "${zts_url}"
  --cert "${cert_path}"
  --key "${key_path}"
  --cacert "${ca_cert}"
  -H "Content-Type: application/x-www-form-urlencoded"
  --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer"
  --data-urlencode "assertion=${id_jag_token}"
  --data-urlencode "scope=${scope}"
  --data-urlencode "expires_in=3600"
)

if [ -n "${actor}" ]; then
  curl_args+=(--data-urlencode "actor=${actor}")
fi

response=$(curl "${curl_args[@]}")
token=$(echo "${response}" | jq -r '.access_token // empty')

if [ -z "${token}" ]; then
  err "Failed to issue an access token with ID_JAG. ZTS Response:" >&2
  echo "${response}" | jq . >&2
  fatal "Token issuance failed for scope: ${scope}"
fi

ok "Access token issued with ID_JAG for scope: ${scope}" >&2
echo "${token}" | jq -R 'split(".") | .[0] | @base64d | fromjson' >&2
echo "${token}" | jq -R 'split(".") | .[1] | @base64d | fromjson' >&2

if [ -n "${output}" ]; then
  echo "${token}" > "${output}"
fi
echo "${token}"
