#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"

if [ -z "${1:-}" ]; then
  fatal "Usage: $0 <service_name>"
fi

service_name=$1
mkdir -p "$(dirname "${service_name}")"

info "Generating RSA key pair for: ${service_name}..."

openssl genrsa -out "${service_name}.old.key" 2048 >/dev/null 2>&1
openssl rsa -in "${service_name}.old.key" -outform PEM -pubout -out "${service_name}.public.key" 2>/dev/null
openssl pkey -in "${service_name}.old.key" -out "${service_name}.key" -traditional
chmod 600 "${service_name}.key"
rm "${service_name}.old.key"

ok "Keys generated: ${service_name}.key, ${service_name}.public.key"
