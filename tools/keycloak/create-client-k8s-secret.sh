#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_keycloak_port=$("$TOOLS_DIR/port.sh" keycloak)
_realm=$("$TOOLS_DIR/config.sh" keycloak realm)

if [ $# -lt 3 ]; then
  fatal "Usage: $0 <client_id> <k8s_namespace> <k8s_secret_name>"
fi

client_id=$1
namespace=$2
secret_name=$3

info "Fetching Keycloak admin token..."

token=$("${TOOLS_DIR}/keycloak/get-admin-token.sh")

info "Looking up UUID for client ${client_id}..."

client_uuid=$(KEYCLOAK_ADMIN_TOKEN="$token" "${TOOLS_DIR}/keycloak/get-client-uuid.sh" "${client_id}")

if [ -z "$client_uuid" ] || [ "$client_uuid" = "null" ]; then
  fatal "Client not found: ${client_id}"
fi

info "Fetching client secret..."

client_secret=$(curl -s \
  "http://localhost:${_keycloak_port}/admin/realms/${_realm}/clients/${client_uuid}/client-secret" \
  -H "Authorization: Bearer ${token}" \
  | sed 's/.*"value":"\([^"]*\)".*/\1/')

if [ -z "$client_secret" ] || [ "$client_secret" = "null" ]; then
  fatal "Failed to fetch secret for client ${client_id}"
fi

info "Creating K8s secret ${namespace}/${secret_name}..."

kubectl -n "${namespace}" delete secret "${secret_name}" --ignore-not-found
kubectl -n "${namespace}" create secret generic "${secret_name}" \
  "--from-literal=client-id=${client_id}" \
  "--from-literal=client-secret=${client_secret}"

ok "Secret created: ${namespace}/${secret_name}"
