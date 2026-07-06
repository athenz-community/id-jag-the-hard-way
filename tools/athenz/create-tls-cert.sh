#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${TOOLS_DIR}/.." && pwd)"
source "${TOOLS_DIR}/color.sh"

if [ $# -lt 3 ]; then
  fatal "Usage: $0 <common_name> <output_prefix> <dns_san> [dns_san...]"
fi

common_name=$1
output_prefix=$2
shift 2
dns_sans=("$@")

ca_cert="${REPO_ROOT}/athenz_dist/certs/ca.cert.pem"
ca_key="${REPO_ROOT}/athenz_dist/keys/ca.private.pem"
key_file="${output_prefix}.private.pem"
csr_file="${output_prefix}.csr.pem"
cert_file="${output_prefix}.cert.pem"
openssl_config=$(mktemp)

cleanup() {
  rm -f "${openssl_config}"
}
trap cleanup EXIT

validate_dns_name() {
  local value=$1
  if [[ ! "${value}" =~ ^[A-Za-z0-9._*-]+$ ]]; then
    fatal "Invalid DNS name '${value}'. Use only letters, numbers, '.', '-', '_', or '*'."
  fi
}

validate_dns_name "${common_name}"
for san in "${dns_sans[@]}"; do
  validate_dns_name "${san}"
done

if [ ! -f "${ca_cert}" ]; then
  fatal "Athenz CA certificate not found: ${ca_cert}"
fi

if [ ! -f "${ca_key}" ]; then
  fatal "Athenz CA private key not found: ${ca_key}"
fi

mkdir -p "$(dirname "${key_file}")"

info "Creating TLS certificate for ${common_name}..."
info "Using Athenz CA: ${ca_cert}"

{
  cat <<EOF
[req]
prompt = no
distinguished_name = req_dn
req_extensions = ext_req

[req_dn]
CN = ${common_name}

[ext_req]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
EOF

  i=1
  for san in "${dns_sans[@]}"; do
    printf 'DNS.%d = %s\n' "${i}" "${san}"
    i=$((i + 1))
  done
} > "${openssl_config}"

openssl genrsa \
  -out "${key_file}" \
  2048 >/dev/null 2>&1
chmod 600 "${key_file}"

openssl req \
  -config "${openssl_config}" \
  -new \
  -key "${key_file}" \
  -out "${csr_file}" \
  -extensions ext_req >/dev/null 2>&1

openssl x509 \
  -req \
  -in "${csr_file}" \
  -CA "${ca_cert}" \
  -CAkey "${ca_key}" \
  -set_serial "0x$(openssl rand -hex 16)" \
  -out "${cert_file}" \
  -days 3650 \
  -extfile "${openssl_config}" \
  -extensions ext_req >/dev/null 2>&1

openssl verify \
  -CAfile "${ca_cert}" \
  "${cert_file}" >/dev/null

ok "Private key saved to: ${key_file}"
ok "CSR saved to: ${csr_file}"
ok "Certificate saved to: ${cert_file}"
