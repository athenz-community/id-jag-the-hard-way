#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_zms_port=$("$TOOLS_DIR/port.sh" zms)

if [ $# -lt 2 ]; then
  echo "Usage: $0 <parent_domain> <subdomain_name>"
  exit 1
fi

parent=$1
name=$2
echo "Creating Subdomain: ${parent}.${name}..."

curl -s -k -X POST "https://localhost:${_zms_port}/zms/v1/subdomain/${parent}" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  -H "Content-Type: application/json" \
  -d '{
    "parent": "'"${parent}"'",
    "name": "'"${name}"'",
    "adminUsers": ["user.athenz_admin"]
  }'

