#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"

if [ $# -lt 6 ]; then
  fatal "Usage: $0 <domain> <policy_name> <effect> <action> <role_name> <resource>"
fi

domain=$1
policy_name=$2
effect=$3
action=$4
role_name=$5
resource=$6

info "Deleting assertion from ${domain}:policy.${policy_name}: ${effect} ${action} to ${role_name} on ${resource}..." >&2

if ! response=$(kubectl -n athenz exec -i deploy/athenz-cli -- \
  zms-cli \
    -i user.athenz_admin \
    -z https://athenz-zms-server.athenz:4443/zms/v1 \
    -key /var/run/athenz/athenz_admin.private.pem \
    -cert /var/run/athenz/athenz_admin.cert.pem \
    -d "${domain}" \
    delete-assertion "${policy_name}" "${effect}" "${action}" to "${role_name}" on "${resource}" 2>&1); then
  if echo "${response}" | grep -qi "policy does not have the specified assertion"; then
    ok "Assertion deleted or already absent: ${domain}:policy.${policy_name}  ${effect} ${action} to ${role_name} on ${resource}" >&2
    exit 0
  fi

  err "ZMS CLI error response:" >&2
  echo "${response}" >&2
  fatal "Failed to delete assertion from ${domain}:policy.${policy_name}"
fi

ok "Assertion deleted or already absent: ${domain}:policy.${policy_name}  ${effect} ${action} to ${role_name} on ${resource}" >&2
