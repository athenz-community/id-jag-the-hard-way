#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zms_port=$("$TOOLS_DIR/port.sh" zms)

if [ $# -lt 3 ]; then
  fatal "Usage: $0 <domain> <group_name> <member_name>"
fi

domain=$1
group_name=$2
member_name=$3

info "Adding Member ${member_name} to Group: ${domain}:group.${group_name}..."

response=$(curl -s -k -X PUT "https://localhost:${_zms_port}/zms/v1/domain/${domain}/group/${group_name}/member/${member_name}" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  -H "Content-Type: application/json" \
  -H "Y-Audit-Ref: local group member test" \
  -d '{
    "memberName": "'"${member_name}"'",
    "groupName": "'"${group_name}"'",
    "isMember": true
  }')

if echo "${response}" | grep -q '"code"'; then
  err "ZMS error response:"
  echo "${response}" >&2
  fatal "Failed to add ${member_name} to ${domain}:group.${group_name}"
fi

ok "${member_name}  ->  ${domain}:group.${group_name}"
