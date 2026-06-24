#!/usr/bin/env bash
# Usage: setup-permissions.sh <path-to-permissions.yaml>
# Applies the full Athenz permission model from the given config file.
# Safe to re-run: deletes the domain first.
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${TOOLS_DIR}/color.sh"

[ $# -lt 1 ] && fatal "Usage: $0 <path-to-permissions.yaml>"
command -v yq &>/dev/null || fatal "yq is required. Install with: brew install yq"

TOOLS="${TOOLS_DIR}/athenz"
CONFIG="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"

# athenz scripts use ./athenz_dist/ relative to the workspace root
cd "${TOOLS_DIR}/.."

DOMAIN=$(yq '.domain' "$CONFIG")
SERVICE_COUNT=$(yq '.services | length' "$CONFIG")
ROLE_COUNT=$(yq '.roles | length' "$CONFIG")

step "Applying permissions"
info "Config:   ${CONFIG}"
info "Domain:   ${DOMAIN}"
info "Services: ${SERVICE_COUNT}  Roles: ${ROLE_COUNT}"

# ── 1. Reset domain ───────────────────────────────────────────────────────────
step "[1/6] Reset domain: ${DOMAIN}"
"$TOOLS/delete-domain.sh" "$DOMAIN"
"$TOOLS/create-tld.sh" "$DOMAIN"
ok "Domain ${DOMAIN} ready"

# ── 2. Service identities ─────────────────────────────────────────────────────
step "[2/6] Service identities (${SERVICE_COUNT})"
for i in $(seq 0 $((SERVICE_COUNT - 1))); do
  svc=$(yq ".services[${i}].name" "$CONFIG")
  key_version=$(yq ".services[${i}].key_version" "$CONFIG")
  keys_dir=$(yq ".services[${i}].local_keys_dir" "$CONFIG")

  step "  ${DOMAIN}.${svc}"
  "$TOOLS/create-private-key.sh" "${keys_dir}/${svc}"
  "$TOOLS/create-service.sh" "$DOMAIN" "$svc" "${keys_dir}/${svc}.public.key"
  "$TOOLS/enable-cert-provider.sh" "$DOMAIN" "$svc"
  info "Fetching X.509 cert (waiting for template to propagate)..."
  fetched=false
  for attempt in $(seq 1 10); do
    if "$TOOLS/fetch-cert.sh" "$DOMAIN" "$svc" "${keys_dir}/${svc}.key" "$key_version" 2>/dev/null; then
      fetched=true; break
    fi
    warn "Attempt ${attempt}/10 failed, retrying in 3s..."
    sleep 3
  done
  $fetched || fatal "Could not fetch cert for ${DOMAIN}.${svc} after 10 attempts"

  if [ "$(yq ".services[${i}].k8s | tag" "$CONFIG")" != "!!null" ]; then
    ns=$(yq ".services[${i}].k8s.ns" "$CONFIG")
    secret=$(yq ".services[${i}].k8s.secret.name" "$CONFIG")
    deployment=$(yq ".services[${i}].k8s.deployment" "$CONFIG")
    cert_k8s=$(yq ".services[${i}].k8s.secret.files.cert.k8s_name" "$CONFIG")
    key_k8s=$(yq ".services[${i}].k8s.secret.files.key.k8s_name" "$CONFIG")
    ca_k8s=$(yq ".services[${i}].k8s.secret.files.ca.k8s_name" "$CONFIG")
    ca_src=$(yq ".services[${i}].k8s.secret.files.ca.import_from" "$CONFIG")
    cert_local=$(yq ".services[${i}].k8s.secret.files.cert.local_name" "$CONFIG")
    key_local=$(yq ".services[${i}].k8s.secret.files.key.local_name" "$CONFIG")

    "$TOOLS/create-k8s-secret.sh" \
      "$ns" "$secret" \
      "${keys_dir}/${cert_local}" \
      "${keys_dir}/${key_local}" \
      "$ca_src" \
      "$cert_k8s" "$key_k8s" "$ca_k8s"
    info "Restarting deployment ${ns}/${deployment}..."
    kubectl rollout restart deploy/"$deployment" -n "$ns"
    kubectl rollout status deploy/"$deployment" -n "$ns"
    ok "k8s secret and deployment updated"
  fi
done

# ── 3. Create roles ───────────────────────────────────────────────────────────
step "[3/6] Create roles (${ROLE_COUNT})"
for i in $(seq 0 $((ROLE_COUNT - 1))); do
  role=$(yq ".roles[${i}].name" "$CONFIG")
  "$TOOLS/create-role.sh" "$DOMAIN" "$role"
done

# ── 4. Add members ────────────────────────────────────────────────────────────
step "[4/6] Add members"
for i in $(seq 0 $((ROLE_COUNT - 1))); do
  role=$(yq ".roles[${i}].name" "$CONFIG")
  member_count=$(yq ".roles[${i}].members | length" "$CONFIG")
  for j in $(seq 0 $((member_count - 1))); do
    member=$(yq ".roles[${i}].members[${j}]" "$CONFIG")
    "$TOOLS/add-role-member.sh" "$DOMAIN" "$role" "$member"
  done
done

# ── 5. Add policies ───────────────────────────────────────────────────────────
step "[5/6] Add policies"
for i in $(seq 0 $((ROLE_COUNT - 1))); do
  role=$(yq ".roles[${i}].name" "$CONFIG")
  policy_count=$(yq ".roles[${i}].policies | length" "$CONFIG")
  for j in $(seq 0 $((policy_count - 1))); do
    action=$(yq ".roles[${i}].policies[${j}].allow" "$CONFIG")
    resource=$(yq ".roles[${i}].policies[${j}].on" "$CONFIG")
    "$TOOLS/add-policy.sh" "$DOMAIN" "$role" "$action" "$resource"
  done
done

# ── Done ──────────────────────────────────────────────────────────────────────
step "[6/6] Done"
ok "Applied ${DOMAIN} from ${CONFIG}"
