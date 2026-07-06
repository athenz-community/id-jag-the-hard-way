#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"

if [ $# -lt 3 ]; then
  fatal "Usage: $0 <private_key_path> <user_principal> <cert_output_path> [callback_port] [expiry_time]"
fi

private_key_path=$1
user_principal=$2
cert_output_path=$3
callback_port=${4:-9213}
expiry_time=${5:-30}

if [ ! -f "${private_key_path}" ]; then
  fatal "Private key file not found: ${private_key_path}"
fi

mkdir -p "$(dirname "${cert_output_path}")"

keycloak_https_port=$("${TOOLS_DIR}/port.sh" keycloak-https)
realm=$("${TOOLS_DIR}/config.sh" keycloak realm)
idp_endpoint="https://localhost:${keycloak_https_port}/realms/${realm}/protocol/openid-connect/auth"
redirect_uri="http://127.0.0.1:${callback_port}/oauth2/callback"
web_origin="http://127.0.0.1:${callback_port}"

remote_prefix="/tmp/zts-usercert-${user_principal//[^A-Za-z0-9]/-}-$$"
remote_key="${remote_prefix}.key"
remote_cert="${remote_prefix}.crt"
fake_bin_dir="/tmp/zts-usercert-bin"
pf_log=$(mktemp)
zts_usercert_log=$(mktemp)
pf_pid=""
zts_pid=""

cleanup() {
  if [ -n "${pf_pid}" ]; then
    kill "${pf_pid}" 2>/dev/null || true
  fi
  if [ -n "${zts_pid}" ]; then
    kill "${zts_pid}" 2>/dev/null || true
  fi
  rm -f "${pf_log}" "${zts_usercert_log}"
  kubectl -n athenz exec -i deploy/athenz-cli -- \
    sh -c "rm -f '${remote_key}' '${remote_cert}'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

info "Checking zts-usercert in athenz-cli..."
zts_usercert_check=$(
  kubectl -n athenz exec -i deploy/athenz-cli -- \
    sh -c 'zts-usercert 2>&1 || true'
)
if ! printf '%s\n' "${zts_usercert_check}" | grep -q "missing required Private Key File or User Name"; then
  err "Unexpected zts-usercert check output:"
  printf '%s\n' "${zts_usercert_check}" >&2
  fatal "zts-usercert is not available in deployment/athenz-cli. Make sure the athenz-cli image contains PR 3239."
fi

info "Ensuring Keycloak client allows callback URI ${redirect_uri}..."
KEYCLOAK_OPEN_UI=false "${TOOLS_DIR}/keycloak/create-client.sh" \
  "athenz-usercert" \
  "${redirect_uri}" \
  "${web_origin}" \
  public

info "Copying private key into athenz-cli..."
b64_key=$(base64 < "${private_key_path}" | tr -d '\n')
printf '%s' "${b64_key}" | kubectl -n athenz exec -i deploy/athenz-cli -- \
  sh -c "base64 -d > '${remote_key}' && chmod 600 '${remote_key}'"

info "Preparing browser URL handoff inside athenz-cli..."
kubectl -n athenz exec -i deploy/athenz-cli -- sh -s -- "${fake_bin_dir}" <<'REMOTE'
set -e
fake_bin_dir=$1
mkdir -p "${fake_bin_dir}"
cat > "${fake_bin_dir}/xdg-open" <<'EOF'
#!/bin/sh
printf '\nOpen this URL in your browser:\n%s\n\n' "$1" >&2
exit 0
EOF
chmod +x "${fake_bin_dir}/xdg-open"
REMOTE

info "Forwarding local callback port ${callback_port} to athenz-cli..."
kubectl -n athenz port-forward deployment/athenz-cli "${callback_port}:${callback_port}" >"${pf_log}" 2>&1 &
pf_pid=$!
sleep 2
if ! kill -0 "${pf_pid}" 2>/dev/null; then
  err "Callback port-forward failed:"
  cat "${pf_log}" >&2
  fatal "Failed to forward callback port ${callback_port}"
fi

info "Running zts-usercert inside athenz-cli..."
info "Opening the Keycloak authorization URL from your host browser..."

kubectl -n athenz exec -i deploy/athenz-cli -- sh -s -- \
  "${fake_bin_dir}" \
  "${remote_key}" \
  "${user_principal}" \
  "${idp_endpoint}" \
  "${remote_cert}" \
  "${callback_port}" \
  "${expiry_time}" >"${zts_usercert_log}" 2>&1 <<'REMOTE' &
set -e
fake_bin_dir=$1
remote_key=$2
user_principal=$3
idp_endpoint=$4
remote_cert=$5
callback_port=$6
expiry_time=$7

PATH="${fake_bin_dir}:${PATH}" zts-usercert \
  -zts "https://athenz-zts-server.athenz:4443/zts/v1" \
  -private-key "${remote_key}" \
  -user "${user_principal}" \
  -idp-endpoint "${idp_endpoint}" \
  -idp-client-id athenz-usercert \
  -cert-file "${remote_cert}" \
  -subj-o Athenz \
  -callback-port "${callback_port}" \
  -expiry-time "${expiry_time}" \
  -cacert /etc/ssl/certs/ca-certificates.crt \
  -proxy=false \
  -verbose
REMOTE
zts_pid=$!

auth_url=""
for _i in $(seq 1 20); do
  auth_url=$(sed -n 's/.*Opening IdP auth URL: \(http.*\)$/\1/p' "${zts_usercert_log}" | tail -1 || true)
  if [ -n "${auth_url}" ]; then
    break
  fi
  if ! kill -0 "${zts_pid}" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [ -n "${auth_url}" ]; then
  "${TOOLS_DIR}/open.sh" "${auth_url}"
else
  err "Could not capture the Keycloak authorization URL from zts-usercert:"
  cat "${zts_usercert_log}" >&2
fi

if ! wait "${zts_pid}"; then
  zts_pid=""
  cat "${zts_usercert_log}" >&2
  fatal "zts-usercert failed for ${user_principal}"
fi
zts_pid=""

info "Copying issued certificate to ${cert_output_path}..."
kubectl -n athenz exec -i deploy/athenz-cli -- cat "${remote_cert}" > "${cert_output_path}"
chmod 600 "${cert_output_path}"

ok "User certificate saved to: ${cert_output_path}"
