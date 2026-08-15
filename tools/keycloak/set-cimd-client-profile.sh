#!/usr/bin/env bash
set -euo pipefail

# Configure the realm-level Client Profile used by the local CIMD research.
# Existing Client Profiles are preserved. An earlier profile with the same
# name is replaced, which makes this helper safe to run more than once.

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"

_keycloak_port=$("${TOOLS_DIR}/port.sh" keycloak)
_realm=$("${TOOLS_DIR}/config.sh" keycloak realm)
_client_host=$("${TOOLS_DIR}/config.sh" keycloak cimd client-host)
_callback_host=$("${TOOLS_DIR}/config.sh" keycloak cimd callback-host)
_admin_token=$("${TOOLS_DIR}/keycloak/get-admin-token.sh")
_profiles_url="http://localhost:${_keycloak_port}/admin/realms/${_realm}/client-policies/profiles"

info "Configuring the CIMD Client Profile in realm ${_realm}..."

_profiles_payload=$(
  curl -fsS \
    -H "Authorization: Bearer ${_admin_token}" \
    "${_profiles_url}" \
  | jq \
    --arg client_host "${_client_host}" \
    --arg callback_host "${_callback_host}" \
    '
      .profiles = (
        (.profiles // [] | map(select(.name != "idthw-cimd-profile")))
        + [{
            "name": "idthw-cimd-profile",
            "description": "Discover the local IDTHW client from its Client ID Metadata Document",
            "executors": [{
              "executor": "client-id-metadata-document",
              "configuration": {
                "cimd-allow-http-scheme": true,
                "cimd-allow-permitted-domains": [
                  $client_host,
                  $callback_host
                ],
                "cimd-restrict-same-domain": false,
                "cimd-required-properties": [
                  "client_id",
                  "redirect_uris",
                  "grant_types"
                ]
              }
            }]
          }]
      )
      | del(.globalProfiles)
    '
)

_http_code=$(
  curl -sS \
    -X PUT \
    -H "Authorization: Bearer ${_admin_token}" \
    -H 'Content-Type: application/json' \
    -d "${_profiles_payload}" \
    -o /dev/null \
    -w '%{http_code}' \
    "${_profiles_url}"
)

case "${_http_code}" in
  2??)
    ok "CIMD Client Profile configured in realm ${_realm} (HTTP ${_http_code})"
    ;;
  *)
    fatal "Failed to configure the CIMD Client Profile (HTTP ${_http_code})"
    ;;
esac
