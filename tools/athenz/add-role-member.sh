#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_zms_port=$("$TOOLS_DIR/port.sh" zms)

if [ $# -lt 3 ]; then
  echo "Usage: $0 <domain> <role_name> <member_name>"
  exit 1
fi

domain=$1
role_name=$2
member_name=$3

echo "Adding Member ${member_name} to Role: ${domain}:role.${role_name}..."

curl -s -k -X PUT "https://localhost:${_zms_port}/zms/v1/domain/${domain}/role/${role_name}/member/${member_name}" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  -H "Content-Type: application/json" \
  -d '{
    "memberName": "'"${member_name}"'",
    "roleName": "'"${role_name}"'"
  }'

