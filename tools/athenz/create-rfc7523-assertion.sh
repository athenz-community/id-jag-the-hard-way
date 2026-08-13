#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"

usage() {
  printf '%s\n' \
    "Usage: $0 --principal <domain.service> --private-key <path> --key-id <id> --audience <zts-issuer> --scope <athenz-scope> [--expires-in <seconds>]"
}

principal=""
private_key=""
key_id=""
audience=""
scope=""
expires_in=3600

while [ $# -gt 0 ]; do
  case "$1" in
    --principal)
      [ $# -ge 2 ] || fatal "Missing value for --principal"
      principal=$2
      shift 2
      ;;
    --private-key)
      [ $# -ge 2 ] || fatal "Missing value for --private-key"
      private_key=$2
      shift 2
      ;;
    --key-id)
      [ $# -ge 2 ] || fatal "Missing value for --key-id"
      key_id=$2
      shift 2
      ;;
    --audience)
      [ $# -ge 2 ] || fatal "Missing value for --audience"
      audience=$2
      shift 2
      ;;
    --scope)
      [ $# -ge 2 ] || fatal "Missing value for --scope"
      scope=$2
      shift 2
      ;;
    --expires-in)
      [ $# -ge 2 ] || fatal "Missing value for --expires-in"
      expires_in=$2
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

[ -n "${principal}" ] || fatal "--principal is required"
[ -n "${private_key}" ] || fatal "--private-key is required"
[ -n "${key_id}" ] || fatal "--key-id is required"
[ -n "${audience}" ] || fatal "--audience is required"
[ -n "${scope}" ] || fatal "--scope is required"

if [[ "${principal}" != *.* ]]; then
  fatal "The principal must be an Athenz service identity in <domain>.<service> form: ${principal}"
fi

if [ ! -f "${private_key}" ]; then
  fatal "Private key file not found: ${private_key}"
fi

if ! [[ "${expires_in}" =~ ^[0-9]+$ ]] || [ "${expires_in}" -le 0 ]; then
  fatal "--expires-in must be a positive integer: ${expires_in}"
fi

command -v jq >/dev/null 2>&1 || fatal "jq is required"
command -v openssl >/dev/null 2>&1 || fatal "openssl is required"

if ! openssl rsa -in "${private_key}" -check -noout >/dev/null 2>&1; then
  fatal "The private key must be a readable RSA key: ${private_key}"
fi

encode_base64url() {
  openssl base64 -A | tr '+/' '-_' | tr -d '='
}

info "Creating RFC 7523 JWT assertion for ${principal}..." >&2

issued_at=$(date +%s)
expires_at=$((issued_at + expires_in))

header_json=$(jq -nc \
  --arg kid "${key_id}" \
  '{alg:"RS256", typ:"at+jwt", kid:$kid}')

claims_json=$(jq -nc \
  --arg iss "${principal}" \
  --arg sub "${principal}" \
  --arg aud "${audience}" \
  --arg scope "${scope}" \
  --argjson iat "${issued_at}" \
  --argjson exp "${expires_at}" \
  '{iss:$iss, sub:$sub, aud:$aud, scope:$scope, iat:$iat, exp:$exp}')

encoded_header=$(printf '%s' "${header_json}" | encode_base64url)
encoded_claims=$(printf '%s' "${claims_json}" | encode_base64url)
signing_input="${encoded_header}.${encoded_claims}"

encoded_signature=$(printf '%s' "${signing_input}" \
  | openssl dgst -sha256 -sign "${private_key}" -binary \
  | encode_base64url)

assertion="${signing_input}.${encoded_signature}"

ok "RFC 7523 JWT assertion signed with key ID ${key_id} (expires in ${expires_in} seconds)" >&2
jq -n \
  --argjson header "${header_json}" \
  --argjson payload "${claims_json}" \
  '{header:$header, payload:$payload}' >&2
printf '%s\n' "${assertion}"
