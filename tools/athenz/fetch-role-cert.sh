#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"

usage() {
  printf '%s\n' \
    "Usage: $0 <role_domain> <role_name> <principal_cert_path> <principal_key_path> [--dns-domain <domain>] [--output <cert_path>]"
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ $# -lt 4 ]; then
  usage >&2
  exit 1
fi

role_domain=$1
role_name=$2
principal_cert_path=$3
principal_key_path=$4
shift 4

dns_domain=""
output_path=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dns-domain)
      [ $# -ge 2 ] || fatal "Missing value for --dns-domain"
      dns_domain=$2
      shift 2
      ;;
    --output)
      [ $# -ge 2 ] || fatal "Missing value for --output"
      output_path=$2
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

if ! [[ "${role_domain}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  fatal "Invalid role domain: ${role_domain}"
fi

if ! [[ "${role_name}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  fatal "Invalid role name: ${role_name}"
fi

if [ -n "${dns_domain}" ] && ! [[ "${dns_domain}" =~ ^[A-Za-z0-9.-]+$ ]]; then
  fatal "Invalid DNS domain: ${dns_domain}"
fi

if [ ! -f "${principal_cert_path}" ]; then
  fatal "Principal certificate file not found: ${principal_cert_path}"
fi

if [ ! -f "${principal_key_path}" ]; then
  fatal "Principal private key file not found: ${principal_key_path}"
fi

principal=$(
  openssl x509 \
    -in "${principal_cert_path}" \
    -noout \
    -subject \
    -nameopt RFC2253 \
    | sed 's/^subject=//' \
    | tr ',' '\n' \
    | sed -n 's/^CN=//p' \
    | sed -n '1p'
)

if [ -z "${principal}" ] || [[ "${principal}" != *.* ]]; then
  fatal "Unable to extract an Athenz service principal from: ${principal_cert_path}"
fi

if ! [[ "${principal}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  fatal "Invalid Athenz principal in certificate: ${principal}"
fi

principal_domain=${principal%.*}
principal_service=${principal##*.}

if [ -z "${output_path}" ]; then
  output_dir=$(dirname "${principal_key_path}")
  output_domain=${role_domain//./-}
  output_role=${role_name//./-}
  output_path="${output_dir}/${output_domain}_${output_role}.crt"
fi

mkdir -p "$(dirname "${output_path}")"

openssl_config=$(mktemp)
csr_file=$(mktemp)
response_file=$(mktemp)
issued_cert_file=$(mktemp)

cleanup() {
  rm -f \
    "${openssl_config}" \
    "${csr_file}" \
    "${response_file}" \
    "${issued_cert_file}"
}
trap cleanup EXIT

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
  printf 'CN = %s:role.%s\n' "${role_domain}" "${role_name}"
  printf '%s\n' \
    '' \
    '[extensions]' \
    'subjectAltName = @san' \
    '' \
    '[san]'
  printf 'URI.1 = spiffe://%s/ra/%s\n' "${role_domain}" "${role_name}"
  printf 'URI.2 = athenz://principal/%s\n' "${principal}"

  if [ -n "${dns_domain}" ]; then
    hyphen_domain=${principal_domain//./-}
    dns_name="${principal_service}.${hyphen_domain}.${dns_domain}"
    printf 'DNS.1 = %s\n' "${dns_name}"
  fi
} > "${openssl_config}"

info "Creating role certificate request for ${role_domain}:role.${role_name} as ${principal}..."

openssl req \
  -new \
  -sha256 \
  -key "${principal_key_path}" \
  -config "${openssl_config}" \
  -out "${csr_file}"

openssl req \
  -in "${csr_file}" \
  -noout \
  -verify >/dev/null

if [ -n "${dns_domain}" ]; then
  info "Requesting DNS SAN: ${dns_name}"
fi

request_body=$(jq -nc \
  --rawfile csr "${csr_file}" \
  '{csr: $csr, expiryTime: 0}')

zts_port=$("${TOOLS_DIR}/port.sh" zts)

if ! http_status=$(curl -skS \
  --cert "${principal_cert_path}" \
  --key "${principal_key_path}" \
  -H 'Content-Type: application/json' \
  -o "${response_file}" \
  -w '%{http_code}' \
  -X POST \
  -d "${request_body}" \
  "https://localhost:${zts_port}/zts/v1/rolecert")
then
  fatal "Failed to connect to ZTS"
fi

if [ "${http_status}" != "200" ]; then
  err "ZTS error response:"
  jq . "${response_file}" 2>/dev/null || sed -n '1,120p' "${response_file}" >&2
  fatal "Failed to fetch role certificate for ${role_domain}:role.${role_name} (HTTP ${http_status})"
fi

if ! jq -er '.x509Certificate' "${response_file}" > "${issued_cert_file}"; then
  fatal "ZTS response did not include x509Certificate"
fi

if ! openssl x509 -in "${issued_cert_file}" -noout >/dev/null 2>&1; then
  fatal "ZTS returned an invalid X.509 role certificate"
fi

mv "${issued_cert_file}" "${output_path}"
chmod 600 "${output_path}"

ok "Role certificate saved to: ${output_path}"
