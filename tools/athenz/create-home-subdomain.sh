#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "${TOOLS_DIR}/.." && pwd)"
source "${TOOLS_DIR}/color.sh"

if [ "$#" -ne 1 ]; then
  fatal "Usage: $0 <id-token-path>"
fi

id_token_path=$1

if [ ! -f "${id_token_path}" ]; then
  fatal "ID token file not found: ${id_token_path}"
fi

if ! command -v jq >/dev/null 2>&1; then
  fatal "jq is required"
fi

if ! command -v curl >/dev/null 2>&1; then
  fatal "curl is required"
fi

# Accept either the athenzd JSON cache envelope or a file containing only the
# raw JWT. Never print the token.
if id_token=$(jq -er '.id_token // empty' "${id_token_path}" 2>/dev/null); then
  :
else
  id_token=$(tr -d '\r\n' < "${id_token_path}")
fi

if [ -z "${id_token}" ]; then
  fatal "ID token is empty: ${id_token_path}"
fi

claims=$(printf '%s' "${id_token}" | jq -Rer '
  split(".") as $parts
  | if ($parts | length) != 3 then error("expected a three-part JWT") else $parts[1] end
  | @base64d
  | fromjson
') || fatal "Unable to decode ID token from: ${id_token_path}"

username=$(printf '%s' "${claims}" | jq -er '.preferred_username // empty') || \
  fatal "ID token does not contain preferred_username"
username=$(printf '%s' "${username}" | tr '[:upper:]' '[:lower:]')

issued_at=$(printf '%s' "${claims}" | jq -er '.iat | numbers') || \
  fatal "ID token does not contain a numeric iat claim"
max_token_age_seconds=${ATHENZ_OIDC_MAX_TOKEN_AGE_SECONDS:-300}
if [[ ! "${max_token_age_seconds}" =~ ^[0-9]+$ ]]; then
  fatal "ATHENZ_OIDC_MAX_TOKEN_AGE_SECONDS must be a non-negative integer"
fi

token_age_seconds=$(($(date +%s) - issued_at))
if [ "${token_age_seconds}" -gt "${max_token_age_seconds}" ]; then
  fatal "ID token is ${token_age_seconds}s old, but ZMS accepts only ${max_token_age_seconds}s; run '(cd athenzd && athenzd login)' and retry immediately"
fi

if [[ ! "${username}" =~ ^[a-z0-9][a-z0-9._-]*$ ]]; then
  fatal "preferred_username is not safe for an Athenz user domain: ${username}"
fi

home_domain="home.${username}"
local_domain_name="local"
local_domain="${home_domain}.${local_domain_name}"
service_name="athenzd"
service_id="${local_domain}.${service_name}"
testing_admin="user.athenz_admin"
zms_port=$("${TOOLS_DIR}/port.sh" zms)
zms_url="${ATHENZ_ZMS_URL:-https://localhost:${zms_port}/zms/v1}"
ca_file="${ATHENZ_CA_FILE:-${REPO_DIR}/athenz_dist/certs/ca.cert.pem}"

if [ ! -f "${ca_file}" ]; then
  fatal "Athenz CA file not found: ${ca_file}"
fi

response_file=$(mktemp)
trap 'rm -f "${response_file}"' EXIT

http_code=""

zms_request() {
  local method=$1
  local url=$2
  local body=${3:-}
  local curl_status=0
  local curl_args=(
    -sS
    --cacert "${ca_file}"
    -o "${response_file}"
    -w '%{http_code}'
    -X "${method}"
    -H "Authorization: Bearer ${id_token}"
  )

  if [ -n "${body}" ]; then
    curl_args+=(
      -H 'Content-Type: application/json'
      -d "${body}"
    )
  fi

  : > "${response_file}"
  http_code=$(curl "${curl_args[@]}" "${url}") || curl_status=$?
  if [ "${curl_status}" -ne 0 ]; then
    fatal "ZMS request failed: ${method} ${url} (curl ${curl_status})"
  fi
}

unexpected_response() {
  local operation=$1
  if [ -s "${response_file}" ]; then
    cat "${response_file}" >&2
  fi
  fatal "${operation} failed with HTTP ${http_code:-000}"
}

step "Authenticating to ZMS with the provided ID token"
zms_request GET "${zms_url}/domain/user"
if [ "${http_code}" != "200" ]; then
  unexpected_response "OIDC authentication check"
fi
ok "Authenticated as user.${username}"

step "Ensuring personal domain ${home_domain}"
zms_request GET "${zms_url}/domain/${home_domain}"
case "${http_code}" in
  200)
    ok "Home domain already exists: ${home_domain}"
    ;;
  404)
    zms_request POST "${zms_url}/userdomain/${username}" "{\"name\":\"${username}\"}"
    case "${http_code}" in
      2??) ok "Home domain created: ${home_domain}" ;;
      *) unexpected_response "Home domain creation" ;;
    esac
    ;;
  *)
    unexpected_response "Home domain lookup"
    ;;
esac

zms_request GET "${zms_url}/domain/${home_domain}"
if [ "${http_code}" != "200" ]; then
  unexpected_response "Home domain verification"
fi

step "Ensuring local subdomain ${local_domain}"
zms_request GET "${zms_url}/domain/${local_domain}"
case "${http_code}" in
  200)
    ok "Local subdomain already exists: ${local_domain}"
    ;;
  404)
    subdomain_body=$(jq -nc \
      --arg parent "${home_domain}" \
      --arg name "${local_domain_name}" \
      --arg owner "user.${username}" \
      --arg testing_admin "${testing_admin}" \
      '{parent: $parent, name: $name, adminUsers: ([$owner, $testing_admin] | unique)}')
    zms_request POST "${zms_url}/subdomain/${home_domain}" "${subdomain_body}"
    case "${http_code}" in
      2??) ok "Local subdomain created: ${local_domain}" ;;
      409) ok "Local subdomain already exists: ${local_domain}" ;;
      *) unexpected_response "Local subdomain creation" ;;
    esac
    ;;
  *)
    unexpected_response "Local subdomain lookup"
    ;;
esac

zms_request GET "${zms_url}/domain/${local_domain}"
if [ "${http_code}" != "200" ]; then
  unexpected_response "Local subdomain verification"
fi

step "Ensuring administrator ${testing_admin} on ${local_domain}"
zms_request GET "${zms_url}/domain/${local_domain}/role/admin"
if [ "${http_code}" != "200" ]; then
  unexpected_response "Local subdomain admin-role lookup"
fi

if jq -e --arg member "${testing_admin}" '
  ((.roleMembers // []) | any(.memberName == $member)) or
  ((.members // []) | any(. == $member))
' "${response_file}" >/dev/null; then
  ok "Administrator already present: ${testing_admin}"
else
  admin_member_body=$(jq -nc \
    --arg member "${testing_admin}" \
    '{memberName: $member, roleName: "admin"}')
  zms_request PUT \
    "${zms_url}/domain/${local_domain}/role/admin/member/${testing_admin}" \
    "${admin_member_body}"
  case "${http_code}" in
    2??) ok "Administrator added: ${testing_admin}" ;;
    *) unexpected_response "Testing administrator addition" ;;
  esac
fi

zms_request GET "${zms_url}/domain/${local_domain}/role/admin"
if [ "${http_code}" != "200" ] || ! jq -e --arg member "${testing_admin}" '
  ((.roleMembers // []) | any(.memberName == $member)) or
  ((.members // []) | any(. == $member))
' "${response_file}" >/dev/null; then
  unexpected_response "Testing administrator verification"
fi

step "Ensuring service ${service_id}"
zms_request GET "${zms_url}/domain/${local_domain}/service/${service_name}"
case "${http_code}" in
  200)
    ok "Service already exists: ${service_id}"
    ;;
  404)
    zms_request PUT "${zms_url}/domain/${local_domain}/service/${service_name}" "{\"name\":\"${service_id}\"}"
    case "${http_code}" in
      2??) ok "Service created: ${service_id}" ;;
      *) unexpected_response "Service creation" ;;
    esac
    ;;
  *)
    unexpected_response "Service lookup"
    ;;
esac

zms_request GET "${zms_url}/domain/${local_domain}/service/${service_name}"
if [ "${http_code}" != "200" ]; then
  unexpected_response "Service verification"
fi

actual_service=$(jq -er '.name // empty' "${response_file}") || \
  fatal "ZMS service response does not contain a name"
if [ "${actual_service}" != "${service_id}" ]; then
  fatal "Unexpected service returned by ZMS: ${actual_service}"
fi

ok "Ready: ${service_id}"
