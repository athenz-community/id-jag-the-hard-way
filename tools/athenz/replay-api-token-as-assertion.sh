#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"

usage() {
  printf '%s\n' \
    "Usage: $0 <scope> [200|400 [expected-error-text]]" \
    "Read one API access token from stdin, use it at /api/docs, then replay it through both JWT assertion paths." \
    "The optional expected status and error text apply to the assertion requests."
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi
if [ $# -lt 1 ] || [ $# -gt 3 ]; then
  usage >&2
  exit 1
fi

[ -n "$1" ] || fatal "The requested scope must not be empty"
case "${2:-}" in
  '') [ $# -eq 1 ] || fatal "Expected HTTP status must be 200 or 400" ;;
  200) [ -z "${3:-}" ] || fatal "Expected error text applies only to HTTP 400" ;;
  400) [ -n "${3:-}" ] || fatal "HTTP 400 requires expected-error-text" ;;
  *) fatal "Expected HTTP status must be 200 or 400" ;;
esac

command -v curl >/dev/null 2>&1 || fatal "curl is required"
command -v jq >/dev/null 2>&1 || fatal "jq is required"

access_token=""
IFS= read -r access_token || [ -n "${access_token}" ] || fatal "Provide an API access token on stdin"
[ -n "${access_token}" ] || fatal "The API access token must not be empty"
api_port=$("${TOOLS_DIR}/port.sh" api-server)
[[ "${api_port}" =~ ^[0-9]+$ ]] || fatal "The configured API port must be numeric"

info 'Using the access token at its intended API...' >&2
if ! printf 'Authorization: Bearer %s\n' "${access_token}" \
  | curl -q --fail -sS --noproxy '*' --connect-timeout 5 --max-time 30 \
    --header @- --write-out '\nHTTP %{http_code}\n' \
    "http://localhost:${api_port}/api/docs"; then
  fatal "Could not use the access token at the local API"
fi

for mode in client-assertion jwt-bearer; do
  fetch_args=(- "$1" --mode "${mode}")
  if [ $# -ge 2 ]; then
    fetch_args+=(--expect "$2")
  fi
  if [ $# -eq 3 ]; then
    fetch_args+=("$3")
  fi
  printf '%s\n' "${access_token}" \
    | "${TOOLS_DIR}/athenz/fetch-access-token-with-rfc7523.sh" "${fetch_args[@]}"
done
