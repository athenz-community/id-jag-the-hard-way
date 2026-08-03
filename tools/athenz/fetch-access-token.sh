#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zts_port=$("$TOOLS_DIR/port.sh" zts)

if [ $# -lt 3 ]; then
  fatal "Usage: $0 <cert_path> <key_path> <scope> [output_file] [--actor <actor>] [--audience <audience>] [--output <output_file>]"
fi

cert_path=$1
key_path=$2
scope=$3
shift 3

output=""
actor=""
audience=""

while [ $# -gt 0 ]; do
  case "$1" in
    --actor)
      [ $# -ge 2 ] || fatal "Missing value for --actor"
      actor=$2
      shift 2
      ;;
    --audience)
      [ $# -ge 2 ] || fatal "Missing value for --audience"
      audience=$2
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

zts_url="https://localhost:${_zts_port}/zts/v1/oauth2/token"

# Print logs to stderr so stdout only outputs the pure token string
info "Fetching Access Token for scope: ${scope}..." >&2

curl_args=(
  -s
  -k
  -X POST "${zts_url}"
  --cert "${cert_path}"
  --key "${key_path}"
  -H "Content-Type: application/x-www-form-urlencoded"
  --data-urlencode "grant_type=client_credentials"
  --data-urlencode "scope=${scope}"
  --data-urlencode "expires_in=3600"
)

if [ -n "${actor}" ]; then
  curl_args+=(--data-urlencode "actor=${actor}")
fi

if [ -n "${audience}" ]; then
  curl_args+=(--data-urlencode "audience=${audience}")
fi

response=$(curl "${curl_args[@]}")

token=$(echo "${response}" | jq -r '.access_token // empty')

if [ -z "${token}" ]; then
  err "Failed to issue an access token. ZTS Response:" >&2
  echo "${response}" | jq . >&2
  fatal "Token issuance failed for scope: ${scope}"
fi

ok "Access token issued for scope: ${scope}" >&2
echo "${token}" | jq -R 'split(".") | .[0] | @base64d | fromjson' >&2
echo "${token}" | jq -R 'split(".") | .[1] | @base64d | fromjson' >&2

if [ -n "${output}" ]; then
  echo "${token}" > "${output}"
fi
echo "${token}"
