#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"

if [ $# -lt 6 ]; then
  fatal "Usage: $0 <namespace> <secret_name> <cert_path> <key_path> <ca_src_path> <cert_k8s_name> <key_k8s_name> <ca_k8s_name>"
fi

namespace=$1
secret_name=$2
cert_path=$3
key_path=$4
ca_src_path=$5
cert_k8s_name=$6
key_k8s_name=$7
ca_k8s_name=$8

info "Creating K8s secret ${namespace}/${secret_name}..."

kubectl -n "${namespace}" delete secret "${secret_name}" --ignore-not-found
kubectl -n "${namespace}" create secret generic "${secret_name}" \
  "--from-file=${cert_k8s_name}=${cert_path}" \
  "--from-file=${key_k8s_name}=${key_path}" \
  "--from-file=${ca_k8s_name}=${ca_src_path}"

ok "Secret created: ${namespace}/${secret_name}"
