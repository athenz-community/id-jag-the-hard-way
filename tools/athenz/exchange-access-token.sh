#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zts_port=$("$TOOLS_DIR/port.sh" zts)

if [ $# -lt 4 ]; then
  fatal "Usage: $0 <cert_path> <key_path> <subject_access_token> <scope> [--actor-token <id_token>] [--actor <actor>] [--audience <audience>] [--token-only]"
fi

cert_path=$1
key_path=$2
subject_access_token=$3
scope=$4
shift 4

actor_token=""
actor=""
audience="api"
token_only="false"
ca_cert="./athenz_dist/certs/ca.cert.pem"
zts_url="https://localhost:${_zts_port}/zts/v1/oauth2/token"

while [ $# -gt 0 ]; do
  case "$1" in
    --actor-token)
      [ $# -ge 2 ] || fatal "Missing value for --actor-token"
      actor_token=$2
      shift 2
      ;;
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
    --token-only)
      token_only="true"
      shift
      ;;
    -*)
      fatal "Unknown option: $1"
      ;;
    *)
      fatal "Unexpected argument: $1"
      ;;
  esac
done

info "Exchanging access token for scope: ${scope}..." >&2

curl_args=(
  -sS
  -X POST "${zts_url}"
  --cert "${cert_path}"
  --key "${key_path}"
  --cacert "${ca_cert}"
  -H "Content-Type: application/x-www-form-urlencoded"
  --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:token-exchange"
  --data-urlencode "requested_token_type=urn:ietf:params:oauth:token-type:access_token"
  --data-urlencode "subject_token_type=urn:ietf:params:oauth:token-type:access_token"
  --data-urlencode "subject_token=${subject_access_token}"
  --data-urlencode "audience=${audience}"
  --data-urlencode "scope=${scope}"
  --data-urlencode "expires_in=3600"
)

if [ -n "${actor_token}" ]; then
  curl_args+=(
    --data-urlencode "actor_token_type=urn:ietf:params:oauth:token-type:id_token"
    --data-urlencode "actor_token=${actor_token}"
  )
fi

if [ -n "${actor}" ]; then
  curl_args+=(--data-urlencode "actor=${actor}")
fi

response=$(curl "${curl_args[@]}")
token=$(echo "${response}" | jq -r '.access_token // empty')

if [ "${token_only}" = "true" ]; then
  if [ -z "${token}" ]; then
    err "Access token was not returned. ZTS response:" >&2
    echo "${response}" | jq . >&2
    fatal "Access token exchange failed for scope: ${scope}"
  fi
  ok "Access token exchanged for scope: ${scope}" >&2
  echo "${token}" | jq -R 'split(".") | .[0] | @base64d | fromjson' >&2
  echo "${token}" | jq -R 'split(".") | .[1] | @base64d | fromjson' >&2
  echo "${token}"
  exit 0
fi

if [ -n "${token}" ]; then
  ok "Access token exchanged for scope: ${scope}" >&2
  echo "${token}" | jq -R 'split(".") | .[0] | @base64d | fromjson' >&2
  echo "${token}" | jq -R 'split(".") | .[1] | @base64d | fromjson' >&2
fi

echo "${response}" | jq .
