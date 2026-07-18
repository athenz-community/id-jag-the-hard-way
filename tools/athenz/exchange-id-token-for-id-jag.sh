#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zts_port=$("$TOOLS_DIR/port.sh" zts)

if [ $# -lt 4 ]; then
  fatal "Usage: $0 <cert_path> <key_path> <id_token> <scope> [--audience <audience>] [--token-only]"
fi

cert_path=$1
key_path=$2
id_token=$3
scope=$4
shift 4

audience="https://athenz-zts-server.athenz:4443/zts/v1"
token_only="false"
ca_cert="./athenz_dist/certs/ca.cert.pem"
zts_url="https://localhost:${_zts_port}/zts/v1/oauth2/token"

while [ $# -gt 0 ]; do
  case "$1" in
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

response=$(curl -sS -X POST "${zts_url}" \
  --cert "${cert_path}" \
  --key "${key_path}" \
  --cacert "${ca_cert}" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  --data-urlencode "requested_token_type=urn:ietf:params:oauth:token-type:id-jag" \
  --data-urlencode "subject_token_type=urn:ietf:params:oauth:token-type:id_token" \
  --data-urlencode "subject_token=${id_token}" \
  --data-urlencode "scope=${scope}" \
  --data-urlencode "audience=${audience}")

if [ "${token_only}" = "true" ]; then
  token=$(echo "${response}" | jq -r '.access_token // empty')
  if [ -z "${token}" ]; then
    err "ID_JAG token was not returned. ZTS response:" >&2
    echo "${response}" | jq . >&2
    fatal "ID_JAG exchange failed for scope: ${scope}"
  fi
  echo "${token}"
  exit 0
fi

echo "${response}"
