#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"

usage() {
  printf '%s\n' "Usage: $0 <jwt_assertion>"
}

if [ $# -ne 1 ]; then
  usage >&2
  fatal "Provide one RFC 7523 JWT assertion"
fi

assertion=$1

[ -n "${assertion}" ] || fatal "The RFC 7523 JWT assertion must not be empty"
command -v curl >/dev/null 2>&1 || fatal "curl is required"
command -v jq >/dev/null 2>&1 || fatal "jq is required"

zts_port=$("${TOOLS_DIR}/port.sh" zts)
zts_url="https://localhost:${zts_port}/zts/v1/oauth2/token"

info "Exchanging RFC 7523 JWT assertion for an access token..." >&2

if ! response=$(
  curl -skS \
    -X POST \
    "${zts_url}" \
    --data-urlencode \
      'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer' \
    --data-urlencode \
      "assertion=${assertion}"
); then
  fatal "Could not connect to the ZTS token endpoint"
fi

if ! access_token=$(
  printf '%s\n' "${response}" \
    | jq -er '.access_token | select(type == "string" and length > 0)' 2>/dev/null
); then
  err "ZTS did not return an access token. Response:" >&2
  if ! printf '%s\n' "${response}" | jq . >&2; then
    printf '%s\n' "${response}" >&2
  fi
  fatal "RFC 7523 access-token issuance failed"
fi

ok "Access token issued through the RFC 7523 JWT bearer grant" >&2
printf '%s\n' "${access_token}" >&2
printf '%s\n' "${access_token}" \
  | jq -R '{
      header: (split(".")[0] | @base64d | fromjson | {typ, alg}),
      claims: (split(".")[1] | @base64d | fromjson
        | {sub, client_id, aud, scp, scope})
    }' >&2
printf '%s\n' "${access_token}"
