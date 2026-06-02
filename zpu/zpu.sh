#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-${ZPU_DOMAIN:-api}}"
CERT="${2:-${ZPU_CERT_PATH:-/var/run/athenz/zpu/cert}}"
KEY="${3:-${ZPU_KEY_PATH:-/var/run/athenz/zpu/key}}"
POLICY_DIR="${4:-${ZPU_POLICY_DIR:-/policies}}"

# Assume ZPU is deployed in the same cluster as Athenz ZTS Server:
ZTS_URL="${ZTS_URL:-athenz-zts-server.athenz:4443/zts/v1}"
INTERVAL="${ZPU_INTERVAL_SECONDS:-5}"
RUN_ONCE="${ZPU_RUN_ONCE:-false}"
REQUIRED="${ZPU_REQUIRED:-true}"

FILE_DOMAIN="${DOMAIN//./_}"
OUT_FILE="${POLICY_DIR}/${FILE_DOMAIN}.pol"
TMP_FILE="${POLICY_DIR}/${FILE_DOMAIN}.pol.tmp.$$"

log() {
  local LEVEL="$1"
  shift
  local MSG="$*"
  local NOW
  NOW=$(TZ="Asia/Tokyo" date '+%Y-%m-%d %H:%M:%S JST')
  echo "[${NOW}] [${LEVEL}] ${MSG}"
}

sync_once() {
  log "INFO" "Getting policy for domain [${DOMAIN}] from [${ZTS_URL}] ..."
  mkdir -p "${POLICY_DIR}"

  set +e
  CURL_OUT=$(curl -fsS -k -X GET "${ZTS_URL%/}/domain/${DOMAIN}/signed_policy_data" \
    -H "Accept: application/json" \
    --cert "${CERT}" \
    --key "${KEY}" 2>&1)
  CURL_STATUS=$?
  set -e

  if [ "${CURL_STATUS}" -eq 0 ]; then
    echo "${CURL_OUT}" > "${TMP_FILE}"
    mv "${TMP_FILE}" "${OUT_FILE}"
    log "INFO" "Successfully synced policy into [${OUT_FILE}]"
    return 0
  fi

  rm -f "${TMP_FILE}"
  ERR_MSG=$(echo "${CURL_OUT}" | head -n 1)
  log "ERROR" "Failed to sync policy for domain [${DOMAIN}]: ${ERR_MSG}"
  return "${CURL_STATUS}"
}

log "INFO" "Starting ZPU domain=[${DOMAIN}], interval=[${INTERVAL}s], run_once=[${RUN_ONCE}], required=[${REQUIRED}]"

if [ "${RUN_ONCE}" = "true" ]; then
  if sync_once; then
    exit 0
  fi

  if [ "${REQUIRED}" = "true" ]; then
    exit 1
  fi

  exit 0
fi

while true; do
  sync_once || true
  sleep "${INTERVAL}"
done
EOF
