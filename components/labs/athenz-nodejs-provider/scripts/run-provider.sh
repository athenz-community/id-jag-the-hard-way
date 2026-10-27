#!/usr/bin/env bash
set -euo pipefail

_nodejs_app_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_nodejs_repo_dir="$(cd "${_nodejs_app_dir}/../../.." && pwd)"
source "${_nodejs_repo_dir}/tools/color.sh"

_nodejs_release=${1:-v1.12.50}
_nodejs_image=${2:-idthw-athenz-nodejs-provider:${_nodejs_release}}
_nodejs_port=${3:-18080}

case "${_nodejs_release}" in
  v1.12.46|v1.12.50) ;;
  *) fatal 'Unsupported Athenz version; choose v1.12.46 or v1.12.50' ;;
esac
[[ ${_nodejs_port} =~ ^[1-9][0-9]{0,4}$ ]] && (( _nodejs_port <= 65535 )) ||
  fatal 'PORT must be an integer from 1 to 65535'

for _nodejs_file in "${_nodejs_app_dir}/.local/athenz.conf" "${_nodejs_app_dir}/.local/policies/api.pol"; do
  [ -f "${_nodejs_file}" ] || fatal "Required public configuration or policy file is missing: ${_nodejs_file}; run make sync first"
done

info "Checking provider image: ${_nodejs_image}"
docker image inspect --format '{{.Id}}' "${_nodejs_image}" >/dev/null ||
  fatal "Provider image is unavailable; run make build VERSION=${_nodejs_release} first"

_nodejs_existing=$(docker container ls --all --format '{{.Names}}')
while IFS= read -r _nodejs_container; do
  case "${_nodejs_container}" in
    idthw-nodejs-provider-v1.12.46|idthw-nodejs-provider-v1.12.50)
      info "Replacing lab container: ${_nodejs_container}"
      docker container stop "${_nodejs_container}"
      # --rm containers disappear after stopping; failed starts may leave one behind.
      _nodejs_remaining=$(docker container ls --all --format '{{.Names}}')
      while IFS= read -r _nodejs_candidate; do
        if [ "${_nodejs_candidate}" = "${_nodejs_container}" ]; then
          docker container rm "${_nodejs_container}"
        fi
      done <<< "${_nodejs_remaining}"
      ;;
  esac
done <<< "${_nodejs_existing}"

info "Starting Node.js provider ${_nodejs_release} at http://127.0.0.1:${_nodejs_port}"
exec docker run --rm --pull=never --name "idthw-nodejs-provider-${_nodejs_release}" \
  --publish "127.0.0.1:${_nodejs_port}:18080" \
  --mount "type=bind,src=${_nodejs_app_dir}/.local/athenz.conf,dst=/app/.local/athenz.conf,readonly" \
  --mount "type=bind,src=${_nodejs_app_dir}/.local/policies,dst=/app/.local/policies,readonly" \
  "${_nodejs_image}"
