#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"

if [ $# -lt 2 ]; then
  fatal "Usage: $0 <domain> <service_name>"
fi

domain=$1
service_name=$2

info "Enabling ZTS Certificate Provider for ${domain}.${service_name}..."

kubectl -n athenz exec -i deploy/athenz-cli -- \
  zms-cli \
    -i user.athenz_admin \
    -z https://athenz-zms-server.athenz:4443/zms/v1 \
    -key /var/run/athenz/athenz_admin.private.pem \
    -cert /var/run/athenz/athenz_admin.cert.pem \
    -d "${domain}" \
    set-domain-template zts_instance_launch_provider service="${service_name}"

ok "ZTS Certificate Provider enabled for ${domain}.${service_name}"
