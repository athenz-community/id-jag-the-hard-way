#!/usr/bin/env bash
set -euo pipefail

_nodejs_app_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_nodejs_repo_dir="$(cd "${_nodejs_app_dir}/../../.." && pwd)"
source "${_nodejs_repo_dir}/tools/color.sh"

_nodejs_endpoints=$(node "${_nodejs_app_dir}/scripts/endpoints.cjs" show)
_nodejs_zms_url=$(jq -er '.zmsUrl' <<< "${_nodejs_endpoints}")
_nodejs_zts_url=$(jq -er '.ztsUrl' <<< "${_nodejs_endpoints}")
_nodejs_ca=${ATHENZ_CA_CERT:-"${_nodejs_repo_dir}/athenz_dist/certs/ca.cert.pem"}
_nodejs_cert=${ATHENZ_CLIENT_CERT:-"${_nodejs_repo_dir}/keys/idjag-learner.crt"}
_nodejs_key=${ATHENZ_CLIENT_KEY:-"${_nodejs_repo_dir}/keys/idjag-learner.key"}
_nodejs_conf=${ATHENZ_CONF:-"${_nodejs_app_dir}/.local/athenz.conf"}
_nodejs_policy_dir=${ATHENZ_POLICY_DIR:-"${_nodejs_app_dir}/.local/policies"}

for _nodejs_file in "${_nodejs_ca}" "${_nodejs_cert}" "${_nodejs_key}"; do
  [ -r "${_nodejs_file}" ] || fatal "Required CA or client identity file is not readable: ${_nodejs_file}"
done

mkdir -p "$(dirname "${_nodejs_conf}")" "${_nodejs_policy_dir}"
_nodejs_snapshot_dir=$(mktemp -d "$(dirname "${_nodejs_conf}")/sync.XXXXXX")

fetch_json() {
  local _nodejs_label=$1 _nodejs_url=$2 _nodejs_output=$3 _nodejs_status
  info "Fetching ${_nodejs_label}: ${_nodejs_url}"
  if ! _nodejs_status=$(curl --silent --show-error \
    --connect-timeout 10 --max-time 30 \
    --cacert "${_nodejs_ca}" --cert "${_nodejs_cert}" --key "${_nodejs_key}" \
    --output "${_nodejs_output}" --write-out '%{http_code}' "${_nodejs_url}"); then
    fatal "Failed to connect while fetching ${_nodejs_label}"
  fi
  if [ "${_nodejs_status}" != 200 ]; then
    err "${_nodejs_label}: HTTP ${_nodejs_status}"
    jq '{code, message}' "${_nodejs_output}" >&2 || warn 'Response was not a JSON error object'
    fatal 'Snapshot refresh failed; the previous configuration and policy files are preserved'
  fi
}

fetch_json 'ZMS public keys' \
  "${_nodejs_zms_url}/domain/sys.auth/service/zms" "${_nodejs_snapshot_dir}/zms.json"
fetch_json 'ZTS public keys' \
  "${_nodejs_zts_url}/domain/sys.auth/service/zts" "${_nodejs_snapshot_dir}/zts.json"
fetch_json 'signed policies' \
  "${_nodejs_zts_url}/domain/api/signed_policy_data" "${_nodejs_snapshot_dir}/api.pol"

if ! jq -en \
  --slurpfile zms "${_nodejs_snapshot_dir}/zms.json" \
  --slurpfile zts "${_nodejs_snapshot_dir}/zts.json" \
  '{zmsPublicKeys: $zms[0].publicKeys, ztsPublicKeys: $zts[0].publicKeys}
   | select((.zmsPublicKeys | type) == "array" and (.ztsPublicKeys | type) == "array")
   | select((.zmsPublicKeys | length) > 0 and (.ztsPublicKeys | length) > 0)' \
  > "${_nodejs_snapshot_dir}/athenz.conf"; then
  fatal 'ZMS or ZTS returned no public verification keys; the previous snapshot is preserved'
fi

if ! jq -e '{
    domain: .signedPolicyData.policyData.domain,
    docsGetterPolicy: any(.signedPolicyData.policyData.policies[].assertions[]?;
      .role == "api:role.docs-getter" and
      .action == "get" and .resource == "api:docs" and (.effect // "ALLOW") == "ALLOW")
  } | select(.domain == "api" and .docsGetterPolicy)' \
  "${_nodejs_snapshot_dir}/api.pol"; then
  fatal 'The docs-getter get policy for api:docs is not available from ZTS yet; the previous snapshot is preserved'
fi

mv "${_nodejs_snapshot_dir}/athenz.conf" "${_nodejs_conf}"
mv "${_nodejs_snapshot_dir}/api.pol" "${_nodejs_policy_dir}/api.pol"
ok 'ZPE public keys and signed policy refreshed'
