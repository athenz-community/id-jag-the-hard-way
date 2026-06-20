#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_zms_port=$("$TOOLS_DIR/port.sh" zms)

if [ $# -lt 4 ]; then
  echo "Usage: $0 <domain> <role_name> <resource> <action>"
  exit 1
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

echo "Creating Policy: ${domain}:policy.${policy_name}..."

curl -s -k -X PUT "https://localhost:${_zms_port}/zms/v1/domain/${domain}/policy/${policy_name}" \
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
  }'
