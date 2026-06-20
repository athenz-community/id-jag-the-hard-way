#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_zts_port=$("$TOOLS_DIR/port.sh" zts)

if [ $# -lt 3 ]; then
  echo "Usage: $0 <cert_path> <key_path> <scope>"
  exit 1
fi

cert_path=$1
key_path=$2
scope=$3
output=$4
zts_url="https://localhost:${_zts_port}/zts/v1/oauth2/token"

# Print logs to stderr so stdout only outputs the pure token string
echo "Fetching Access Token for scope: ${scope}..." >&2

response=$(curl -s -k -X POST "${zts_url}" \
  --cert "${cert_path}" \
  --key "${key_path}" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&scope=${scope}&expires_in=3600")

token=$(echo "${response}" | jq -r '.access_token // empty')

if [ -z "${token}" ]; then
  echo "🔥 [ERROR] Failed to issue an access token. ZTS Response:" >&2
  echo "${response}" | jq . >&2
  exit 1
else
  echo "✅ [SUCCESS] Issued the following access token:" >&2
  echo "${token}" | jq -R 'split(".") | .[0] | @base64d | fromjson' >&2
  echo "${token}" | jq -R 'split(".") | .[1] | @base64d | fromjson' >&2
  echo "${token}" > "${output}"
  echo "${token}"
fi
