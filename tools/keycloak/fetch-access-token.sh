#!/usr/bin/env bash
set -euo pipefail

# Exchange a Keycloak authorization code for an access token using PKCE.
# Token details are written to stderr for inspection. Only the raw access
# token is written to stdout so callers can use command substitution.

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"

if [ "$#" -ne 2 ]; then
  fatal "Usage: $0 <authorization_code> <code_verifier>"
fi

_authorization_code=$1
_code_verifier=$2
_keycloak_port=$("${TOOLS_DIR}/port.sh" keycloak)
_realm=$("${TOOLS_DIR}/config.sh" keycloak realm)
_client_id=$("${TOOLS_DIR}/config.sh" keycloak cimd client-id)
_redirect_uri=$("${TOOLS_DIR}/config.sh" keycloak cimd redirect-uri)

info "Exchanging the authorization code for a Keycloak access token..." >&2

_token_response=$(
  curl -sS \
    -X POST \
    "http://localhost:${_keycloak_port}/realms/${_realm}/protocol/openid-connect/token" \
    --data-urlencode 'grant_type=authorization_code' \
    --data-urlencode "client_id=${_client_id}" \
    --data-urlencode "redirect_uri=${_redirect_uri}" \
    --data-urlencode "code=${_authorization_code}" \
    --data-urlencode "code_verifier=${_code_verifier}"
)

if ! _access_token=$(printf '%s\n' "${_token_response}" | jq -er '.access_token' 2>/dev/null); then
  err "Keycloak token error response:"
  printf '%s\n' "${_token_response}" | jq >&2 || printf '%s\n' "${_token_response}" >&2
  fatal "Failed to fetch a Keycloak access token."
fi

ok "Keycloak access token received." >&2
printf '%s\n' "${_token_response}" \
  | jq '{
      access_token,
      token_type,
      expires_in,
      access_token_claims: (
        .access_token
        | split(".")[1]
        | @base64d
        | fromjson
        | {iss, sub, azp, scope}
      )
    }' >&2

printf '%s\n' "${_access_token}"
