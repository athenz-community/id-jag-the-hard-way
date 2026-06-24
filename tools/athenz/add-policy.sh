#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zms_port=$("$TOOLS_DIR/port.sh" zms)

if [ $# -lt 4 ]; then
  fatal "Usage: $0 <domain> <role_name> <action> <resource>"
fi

domain=$1
role_name=$2
action=$3
resource=$4

sanitize_policy_name() {
  local s="$1"

  s="$(printf '%s' "$s" \
    | sed -E 's/[^A-Za-z0-9_-]+/_/g; s/_+/_/g; s/^_+//; s/_+$//')"

  if [ -z "$s" ]; then
    s="policy"
  fi

  if [[ ! "$s" =~ ^[A-Za-z0-9_] ]]; then
    s="_${s}"
  fi

  printf '%s' "$s"
}

raw_policy_name="${role_name}_${action}_${resource}"
policy_name="$(sanitize_policy_name "$raw_policy_name")"

info "Creating Policy: ${domain}:policy.${policy_name}..."

response=$(curl -s -k -X PUT "https://localhost:${_zms_port}/zms/v1/domain/${domain}/policy/${policy_name}" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  -H "Content-Type: application/json" \
  -d '{
    "name": "'"${domain}:policy.${policy_name}"'",
    "assertions": [
      {
        "role": "'"${domain}:role.${role_name}"'",
        "resource": "'"${domain}:${resource}"'",
        "action": "'"${action}"'"
      }
    ]
  }')

if echo "${response}" | grep -q '"code"'; then
  err "ZMS error response:"
  echo "${response}" >&2
  fatal "Failed to create policy ${domain}:policy.${policy_name}"
fi

ok "Policy created: ${domain}:policy.${policy_name}"
