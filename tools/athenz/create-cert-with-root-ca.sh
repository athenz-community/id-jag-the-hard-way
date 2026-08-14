#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${TOOLS_DIR}/.." && pwd)"
source "${TOOLS_DIR}/color.sh"

usage() {
  printf '%s\n' \
    "Usage: $0 <domain> <service> <private_key_path> <cert_output_path> [--dns-domain <domain>]"
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ $# -lt 4 ]; then
  usage >&2
  exit 1
fi

domain=$1
service=$2
private_key_path=$3
cert_output_path=$4
shift 4

dns_domain=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dns-domain)
      [ $# -ge 2 ] || fatal "Missing value for --dns-domain"
      dns_domain=$2
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fatal "Unknown option: $1"
      ;;
  esac
done

if ! [[ "${domain}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  fatal "Invalid Athenz domain: ${domain}"
fi

if ! [[ "${service}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  fatal "Invalid Athenz service: ${service}"
fi

if [ -n "${dns_domain}" ] && ! [[ "${dns_domain}" =~ ^[A-Za-z0-9.-]+$ ]]; then
  fatal "Invalid DNS domain: ${dns_domain}"
fi

if [ ! -f "${private_key_path}" ]; then
  fatal "Private key file not found: ${private_key_path}"
fi

ca_cert="${REPO_ROOT}/athenz_dist/certs/ca.cert.pem"
ca_key="${REPO_ROOT}/athenz_dist/keys/ca.private.pem"

if [ ! -f "${ca_cert}" ]; then
  fatal "Athenz root CA certificate not found: ${ca_cert}"
fi

if [ ! -f "${ca_key}" ]; then
  fatal "Athenz root CA private key not found: ${ca_key}"
fi

mkdir -p "$(dirname "${cert_output_path}")"

openssl_config=$(mktemp)
csr_file=$(mktemp)

cleanup() {
  rm -f "${openssl_config}" "${csr_file}"
}
trap cleanup EXIT

principal="${domain}.${service}"

{
  printf '%s\n' \
    '[req]' \
    'prompt = no' \
    'distinguished_name = subject' \
    'req_extensions = extensions' \
    '' \
    '[subject]' \
    'C = US' \
    'O = Oath Inc.' \
    'OU = Athenz'
  printf 'CN = %s\n' "${principal}"
  printf '%s\n' \
    '' \
    '[extensions]' \
    'basicConstraints = critical,CA:FALSE' \
    'keyUsage = critical,digitalSignature,keyEncipherment' \
    'extendedKeyUsage = clientAuth' \
    'subjectAltName = @san' \
    '' \
    '[san]'
  printf 'URI.1 = spiffe://%s/sa/%s\n' "${domain}" "${service}"

  if [ -n "${dns_domain}" ]; then
    hyphen_domain=${domain//./-}
    dns_name="${service}.${hyphen_domain}.${dns_domain}"
    printf 'DNS.1 = %s\n' "${dns_name}"
  fi
} > "${openssl_config}"

info "Creating certificate for ${principal} with the tutorial root CA..."

openssl req \
  -new \
  -sha256 \
  -key "${private_key_path}" \
  -config "${openssl_config}" \
  -out "${csr_file}"

openssl x509 \
  -req \
  -in "${csr_file}" \
  -CA "${ca_cert}" \
  -CAkey "${ca_key}" \
  -set_serial "0x$(openssl rand -hex 16)" \
  -days 1 \
  -sha256 \
  -extfile "${openssl_config}" \
  -extensions extensions \
  -out "${cert_output_path}" \
  >/dev/null 2>&1

openssl verify \
  -CAfile "${ca_cert}" \
  "${cert_output_path}" >/dev/null

chmod 600 "${cert_output_path}"

if [ -n "${dns_domain}" ]; then
  info "Included DNS SAN: ${dns_name}"
fi

ok "Certificate saved to: ${cert_output_path}"
