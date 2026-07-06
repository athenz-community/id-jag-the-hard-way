#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"

default_namespace="${CONFLUENCE_MCP_NAMESPACE:-mcp-hub}"
default_secret_name="${CONFLUENCE_MCP_SECRET_NAME:-confluence-mcp-env}"
default_token_name="${CONFLUENCE_API_TOKEN_NAME:-id-jag-confluence-mcp}"
default_url="${CONFLUENCE_URL:-https://idjag.atlassian.net/wiki}"
default_username="${CONFLUENCE_USERNAME:-}"
default_token="${CONFLUENCE_API_TOKEN:-}"

prompt_default() {
  local var_name=$1
  local prompt=$2
  local default_value=$3
  local value

  if [ -n "${default_value}" ]; then
    read -r -p "${prompt} (Enter for default: ${default_value}): " value
    printf -v "${var_name}" "%s" "${value:-$default_value}"
  else
    read -r -p "${prompt}: " value
    printf -v "${var_name}" "%s" "${value}"
  fi
}

prompt_secret() {
  local var_name=$1
  local prompt=$2
  local default_value=$3
  local value

  if [ -n "${default_value}" ]; then
    read -r -s -p "${prompt} (Enter for default: existing CONFLUENCE_API_TOKEN): " value
    printf "\n" >&2
    printf -v "${var_name}" "%s" "${value:-$default_value}"
  else
    read -r -s -p "${prompt}: " value
    printf "\n" >&2
    printf -v "${var_name}" "%s" "${value}"
  fi
}

step "Create Confluence admin API token secret"

prompt_default namespace "Kubernetes namespace" "${default_namespace}"
prompt_default secret_name "Kubernetes secret name" "${default_secret_name}"
prompt_default token_name "Confluence API token name" "${default_token_name}"
prompt_default confluence_url "Confluence URL" "${default_url}"
prompt_default confluence_username "Confluence username (Atlassian login email)" "${default_username}"
prompt_secret confluence_api_token "Confluence API token value" "${default_token}"

[ -n "${namespace}" ] || fatal "Kubernetes namespace is required"
[ -n "${secret_name}" ] || fatal "Kubernetes secret name is required"
[ -n "${token_name}" ] || fatal "Confluence API token name is required"
[ -n "${confluence_url}" ] || fatal "Confluence URL is required"
[ -n "${confluence_username}" ] || fatal "Confluence username is required"
[ -n "${confluence_api_token}" ] || fatal "Confluence API token is required"

info "Ensuring namespace ${namespace} exists..."
kubectl create namespace "${namespace}" --dry-run=client -o yaml | kubectl apply -f -

info "Creating K8s secret ${namespace}/${secret_name}..."
kubectl -n "${namespace}" delete secret "${secret_name}" --ignore-not-found
kubectl -n "${namespace}" create secret generic "${secret_name}" \
  "--from-literal=CONFLUENCE_API_TOKEN_NAME=${token_name}" \
  "--from-literal=CONFLUENCE_URL=${confluence_url}" \
  "--from-literal=CONFLUENCE_USERNAME=${confluence_username}" \
  "--from-literal=CONFLUENCE_API_TOKEN=${confluence_api_token}"

ok "Secret created: ${namespace}/${secret_name}"
info "This secret is expected by the confluence-mcp deployment as envFrom.secretRef.name=${secret_name}"
