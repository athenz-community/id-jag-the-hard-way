#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_zms_port=$("$TOOLS_DIR/port.sh" zms)

if [ -z "${1:-}" ]; then
  fatal "Usage: $0 <domain>"
fi

domain=$1

info "Deleting domain: ${domain}..."

curl -s -k -X DELETE "https://localhost:${_zms_port}/zms/v1/domain/${domain}" \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  -H "Content-Type: application/json" || true

ok "Domain deleted (or did not exist): ${domain}"
