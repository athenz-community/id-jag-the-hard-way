#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"
_keycloak_port=$("$TOOLS_DIR/port.sh" keycloak)
_realm=$("$TOOLS_DIR/config.sh" keycloak realm)
_admin=$("$TOOLS_DIR/config.sh" keycloak admin)
_admin_password=$("$TOOLS_DIR/config.sh" keycloak admin-password)

if [ $# -lt 3 ]; then
  fatal "Usage: $0 <client_id> <k8s_namespace> <k8s_secret_name>"
fi

client_id=$1
namespace=$2
secret_name=$3

info "Fetching Keycloak admin token..."

token=$(curl -s -X POST \
  "http://localhost:${_keycloak_port}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" \
  -d "username=${_admin}" \
  -d "password=${_admin_password}" \
  -d "grant_type=password" \
  | sed 's/.*"access_token":"\([^"]*\)".*/\1/')

if [ -z "$token" ] || [ "$token" = "null" ]; then
  fatal "Failed to obtain admin token — check keycloak.admin / keycloak.admin-password in tools/config.yaml"
fi

info "Looking up UUID for client ${client_id}..."

client_uuid=$(curl -s \
  "http://localhost:${_keycloak_port}/admin/realms/${_realm}/clients?clientId=${client_id}" \
  -H "Authorization: Bearer ${token}" \
  | sed 's/.*"id":"\([^"]*\)".*/\1/' | head -1)

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
