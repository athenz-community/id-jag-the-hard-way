#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"

version_pattern='^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'

usage() {
  printf '%s\n' \
    "Usage: $0 <minimum-version> [zts|zms] [namespace]" \
    "       $0 --less-or-equal <maximum-version> [zts|zms] [namespace]" \
    "       $0 --show [namespace]" \
    "Defaults: zts, namespace athenz. Example: $0 1.12.48" \
    "Read the build VERSION from each ready server container and require version >= minimum." \
    "--less-or-equal requires version <= maximum (alias: --LESS-OR-EQUAL)." \
    "--show displays both ZMS and ZTS versions, source tags or commit SHAs, build suffixes and pods." \
    "Exit codes: 0 = success, 1 = outside the version limit, 2 = unable to read or verify build metadata."
}

error() {
  err "$*"
  exit 2
}

server_pods() {
  local container=$1
  shift
  local query='{range .items[*]}{.metadata.name}{"|"}{.metadata.deletionTimestamp}{"|"}{.status.phase}{"|"}{.status.containerStatuses[?(@.name=="CONTAINER")].ready}{"\n"}{end}'
  query=${query//CONTAINER/${container}}
  kubectl "$@" --request-timeout=10s get pods \
    -l "app.kubernetes.io/name=${container}" "-o=jsonpath=${query}"
}

show_versions() {
  local namespace=${1:-athenz} context component component_name container pods
  local pod deleting phase ready metadata version revision source_label source_value build_suffix
  local errors=0 active_pods complete
  local revision_pattern='^[0-9a-fA-F]{7,64}(-[0-9A-Za-z_.-]+)?$'
  command -v kubectl >/dev/null 2>&1 || error "kubectl is required"
  if ! context=$(kubectl config current-context) || [ -z "${context}" ]; then
    error "Could not determine the current Kubernetes context"
  fi
  local kubectl_options=(--context "${context}" -n "${namespace}")
  step "Athenz versions"
  info "Context: ${context}  Namespace: ${namespace}"

  for component in zms zts; do
    case "${component}" in
      zms) component_name=ZMS ;;
      zts) component_name=ZTS ;;
    esac
    container="athenz-${component}-server"
    if ! pods=$(server_pods "${container}" "${kubectl_options[@]}"); then
      err "Could not list ${component_name} pods in namespace ${namespace}"
      errors=$((errors + 1))
      continue
    fi
    active_pods=0
    while IFS='|' read -r pod deleting phase ready; do
      [ -n "${pod}" ] || continue
      if [ -n "${deleting}" ]; then
        warn "Skipping terminating pod ${pod}"
        continue
      fi
      active_pods=$((active_pods + 1))
      printf '\n'
      if [ "${phase}" != "Running" ] || [ "${ready}" != "true" ]; then
        err "${component_name}: ${pod} is not ready (phase: ${phase:-unknown}, ready: ${ready:-unknown})"
        errors=$((errors + 1))
        continue
      fi

      # Release images record a source tag in VCS_REF; custom builds record a
      # commit SHA, optionally followed by a build suffix (including dirty markers).
      if ! metadata=$(kubectl "${kubectl_options[@]}" --request-timeout=10s exec "${pod}" \
        -c "${container}" -- sh -c 'printf "%s|%s\n" "${VERSION-}" "${VCS_REF-}"'); then
        err "Could not read build metadata from ${pod}"
        errors=$((errors + 1))
        continue
      fi
      IFS='|' read -r version revision <<< "${metadata}"
      complete=true
      if [[ "${metadata}" == *$'\n'* ]] || ! [[ "${version}" =~ ${version_pattern} ]]; then
        version=unknown
        complete=false
      fi
      source_label=SHA
      source_value=unknown
      build_suffix=
      if [[ "${metadata}" != *$'\n'* ]] && [[ "${revision}" =~ ${revision_pattern} ]]; then
        source_value=${revision%%-*}
        if [ "${source_value}" != "${revision}" ]; then
          build_suffix=${revision#*-}
        fi
      elif [[ "${metadata}" != *$'\n'* ]] && [[ "${revision}" =~ ${version_pattern} ]]; then
        source_label=Tag
        source_value=${revision}
      else
        complete=false
      fi
      if [ "${complete}" = true ]; then
        ok "${component_name}  ${version}"
      else
        warn "${component_name}  ${version} (missing or unsupported build metadata)"
        errors=$((errors + 1))
      fi
      printf "     ${DIM}%-5s${RESET} %s\n" "${source_label}" "${source_value}"
      if [ -n "${build_suffix}" ]; then
        printf "     ${DIM}%-5s${RESET} %s\n" Build "${build_suffix}"
      fi
      printf "     ${DIM}%-5s${RESET} %s\n" Pod "${pod}"
    done <<< "${pods}"
    if [ "${active_pods}" -eq 0 ]; then
      err "No non-terminating ${component_name} pods found in namespace ${namespace}"
      errors=$((errors + 1))
    fi
  done
  printf '\n'
  if [ "${errors}" -gt 0 ]; then
    err "Athenz build information is incomplete"
    return 2
  fi
  return 0
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi
if [ "${1:-}" = "--show" ]; then
  if [ $# -gt 2 ]; then
    usage >&2
    exit 2
  fi
  show_versions "${2:-athenz}"
  exit 0
fi
bound=minimum
case "${1:-}" in
  --less-or-equal|--LESS-OR-EQUAL)
    bound=maximum
    shift
    ;;
esac
if [ $# -lt 1 ] || [ $# -gt 3 ]; then
  usage >&2
  exit 2
fi

limit=${1#v}
component=${2:-zts}
namespace=${3:-athenz}
release_pattern='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
if ! [[ "${limit}" =~ ${release_pattern} ]]; then
  if [ "${bound}" = maximum ]; then
    error "Maximum version must be a release version such as 1.12.47 or v1.12.47"
  fi
  error "Minimum version must be a release version such as 1.12.48 or v1.12.48"
fi
case "${component}" in
  zts) component_name=ZTS ;;
  zms) component_name=ZMS ;;
  *) error "Component must be zts or zms" ;;
esac
command -v kubectl >/dev/null 2>&1 || error "kubectl is required"
command -v jq >/dev/null 2>&1 || error "jq is required"

container="athenz-${component}-server"
info "Checking Athenz ${component_name} version (${bound}: ${limit}, namespace: ${namespace})..."

if ! pods=$(server_pods "${container}" -n "${namespace}"); then
  error "Could not list ${component_name} pods in namespace ${namespace}"
fi
[ -n "${pods}" ] || error "No ${component_name} pods found in namespace ${namespace}"

checked=0
failed=0
errors=0
while IFS='|' read -r pod deleting phase ready; do
  [ -n "${pod}" ] || continue
  if [ -n "${deleting}" ]; then
    warn "Skipping terminating pod ${pod}"
    continue
  fi
  if [ "${phase}" != "Running" ] || [ "${ready}" != "true" ]; then
    err "${pod} is not ready (phase: ${phase:-unknown}, ready: ${ready:-unknown})"
    errors=$((errors + 1))
    continue
  fi

  # VERSION is build metadata set by the IDTHW distribution Dockerfiles.
  # Read only that named value; image tags such as latest are not versions.
  if ! version=$(kubectl --request-timeout=10s -n "${namespace}" exec "${pod}" \
    -c "${container}" -- printenv VERSION); then
    err "Could not read the build VERSION from ${pod}"
    errors=$((errors + 1))
    continue
  fi
  if ! [[ "${version}" =~ ${version_pattern} ]]; then
    err "${pod} has a missing or unsupported build VERSION"
    errors=$((errors + 1))
    continue
  fi

  normalized=${version#v}
  normalized=${normalized%%+*}
  base_version=${normalized%%-*}
  prerelease=false
  [[ "${normalized}" != *-* ]] || prerelease=true
  checked=$((checked + 1))

  # Compare numeric components. A prerelease sorts before its matching release;
  # build metadata does not affect precedence.
  comparison_status=0
  jq -en --arg actual "${base_version}" --arg limit "${limit}" \
    --arg bound "${bound}" --argjson prerelease "${prerelease}" '
      ($actual | split(".") | map(tonumber)) as $actual_parts |
      ($limit | split(".") | map(tonumber)) as $limit_parts |
      if $bound == "maximum" then
        $actual_parts <= $limit_parts
      else
        ($actual_parts > $limit_parts) or
        ($actual_parts == $limit_parts and ($prerelease | not))
      end
    ' >/dev/null || comparison_status=$?
  case "${comparison_status}" in
    0)
      if [ "${bound}" = maximum ]; then
        ok "${pod}: ${version} is at or below the maximum ${limit}"
      else
        ok "${pod}: ${version} meets the minimum ${limit}"
      fi
      ;;
    1)
      if [ "${bound}" = maximum ]; then
        err "${pod}: ${version} is above the maximum ${limit}"
      else
        err "${pod}: ${version} is below the minimum ${limit}"
      fi
      failed=$((failed + 1))
      ;;
    *)
      err "Could not compare the build VERSION from ${pod}"
      errors=$((errors + 1))
      ;;
  esac
done <<< "${pods}"

if [ "${errors}" -gt 0 ]; then
  err "Athenz ${component_name} version check could not be completed"
  exit 2
fi
[ "${checked}" -gt 0 ] || error "No non-terminating ready ${component_name} pods available to verify"
if [ "${failed}" -gt 0 ]; then
  if [ "${bound}" = maximum ]; then
    err "Athenz ${component_name} must be ${limit} or older (${failed} of ${checked} checked pods above maximum)"
  else
    err "Athenz ${component_name} must be ${limit} or newer (${failed} of ${checked} checked pods below minimum)"
  fi
  if [ "${bound}" = minimum ] && [ "${namespace}" = "athenz" ]; then
    info "To upgrade local IDTHW (kind), run from IDTHW or the internal context repository root:" >&2
    info "  make athenz-vup VERSION=${limit}" >&2
    info "Or use the latest stable Athenz tag: make athenz-vup" >&2
    info "Add DRY_RUN=true to preview the SQL and rollout plan." >&2
  fi
  exit 1
fi
ok "Athenz ${component_name} version check passed"
