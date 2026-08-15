#!/usr/bin/env bash
set -euo pipefail

# Configure the realm-level Client Policy used by the local CIMD research.
# Existing Client Policies are preserved. An earlier policy with the same
# name is replaced, which makes this helper safe to run more than once.

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"

_keycloak_port=$("${TOOLS_DIR}/port.sh" keycloak)
_realm=$("${TOOLS_DIR}/config.sh" keycloak realm)
_client_host=$("${TOOLS_DIR}/config.sh" keycloak cimd client-host)
_admin_token=$("${TOOLS_DIR}/keycloak/get-admin-token.sh")
_policies_url="http://localhost:${_keycloak_port}/admin/realms/${_realm}/client-policies/policies"

info "Configuring the CIMD Client Policy in realm ${_realm}..."

_policies_payload=$(
  curl -fsS \
    -H "Authorization: Bearer ${_admin_token}" \
    "${_policies_url}" \
  | jq \
    --arg client_host "${_client_host}" \
    '
      .policies = (
        (.policies // [] | map(select(.name != "idthw-cimd-policy")))
        + [{
            "name": "idthw-cimd-policy",
            "description": "Apply CIMD only to the local IDTHW research domain",
            "enabled": true,
            "conditions": [{
              "condition": "client-id-uri",
              "configuration": {
                "client-id-uri-scheme": ["http"],
                "client-id-uri-allow-permitted-domains": [
                  $client_host
                ]
              }
            }],
            "profiles": ["idthw-cimd-profile"]
          }]
      )
      | del(.globalPolicies)
    '
)

_http_code=$(
  curl -sS \
    -X PUT \
    -H "Authorization: Bearer ${_admin_token}" \
    -H 'Content-Type: application/json' \
    -d "${_policies_payload}" \
    -o /dev/null \
    -w '%{http_code}' \
    "${_policies_url}"
)

case "${_http_code}" in
  2??)
    ok "CIMD Client Policy configured in realm ${_realm} (HTTP ${_http_code})"
    ;;
  *)
    fatal "Failed to configure the CIMD Client Policy (HTTP ${_http_code})"
    ;;
esac
