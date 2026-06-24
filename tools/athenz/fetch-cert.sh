#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"

if [ $# -lt 4 ]; then
  fatal "Usage: $0 <domain> <service> <private_key_path> <key_version>"
fi

domain=$1
service=$2
private_key_path=$3
key_version=$4

out_cert_file="${private_key_path%.key}.crt"
zts_url="https://athenz-zts-server.athenz:4443/zts/v1"

info "Fetching X.509 Certificate for ${domain}.${service}..."

# Base64 encode the private key to safely pass it into the kubectl exec session
b64_key=$(base64 < "${private_key_path}" | tr -d '\n')

kubectl exec -i deploy/athenz-cli -n athenz -- sh -c "
  echo '${b64_key}' | base64 -d > /tmp/${service}.key && \
  zts-svccert \
    -domain ${domain} \
    -service ${service} \
    -private-key /tmp/${service}.key \
    -key-version ${key_version} \
    -zts ${zts_url} \
    -dns-domain zts.athenz.cloud \
    -provider sys.auth.zts \
    -instance \$(date +%s) \
    -cert-file /tmp/${service}.crt > /dev/null 2>&1 && \
  cat /tmp/${service}.crt && \
  rm -f /tmp/${service}.key /tmp/${service}.crt
" > "${out_cert_file}"

ok "Certificate saved to: ${out_cert_file}"
