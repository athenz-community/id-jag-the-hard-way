#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${TOOLS_DIR}/color.sh"

LOCAL_CONFIG="$TOOLS_DIR/config.local.yaml"
PID_FILE="$TOOLS_DIR/.port-forward.pid"

get_port() {
  "$TOOLS_DIR/port.sh" "$1"
}

save_port() {
  local name="$1"
  local value="$2"
  if [ ! -f "$LOCAL_CONFIG" ]; then
    echo "ports:" > "$LOCAL_CONFIG"
  fi
  if grep -q "  ${name}:" "$LOCAL_CONFIG" 2>/dev/null; then
    sed -i '' "s|  ${name}:.*|  ${name}: ${value}|" "$LOCAL_CONFIG" 2>/dev/null || \
      sed -i  "s|  ${name}:.*|  ${name}: ${value}|" "$LOCAL_CONFIG"
  else
    echo "  ${name}: ${value}" >> "$LOCAL_CONFIG"
  fi
}

is_port_in_use() {
  local port="$1"
  if command -v lsof &>/dev/null; then
    lsof -iTCP:"$port" -sTCP:LISTEN -t &>/dev/null
  elif command -v ss &>/dev/null; then
    ss -tlnp | grep -q ":${port} "
  else
    (echo >/dev/tcp/localhost/"$port") &>/dev/null
  fi
}

# Singleton check
if [ -f "$PID_FILE" ]; then
  old_pid=$(cat "$PID_FILE")
  if kill -0 "$old_pid" 2>/dev/null; then
    warn "keep-k8s-port-forward.sh is already running (PID $old_pid)."
    read -rp "  Stop it and start a new one? [y/N]: " _answer
    case "$_answer" in
      [yY]*)
        kill -- "-${old_pid}" 2>/dev/null || kill "$old_pid" 2>/dev/null || true
        info "Waiting for old port-forwards to close..."
        for _i in $(seq 1 15); do
          kill -0 "$old_pid" 2>/dev/null || break
          sleep 1
        done
        ;;
      *) info "Exiting."; exit 0 ;;
    esac
  fi
  rm -f "$PID_FILE"
fi

echo $$ > "$PID_FILE"
trap 'rm -f "$PID_FILE"; kill -- -$$ 2>/dev/null || kill $(jobs -p) 2>/dev/null || true' EXIT

# Resolve a port: if in use, prompt for a replacement and save it
resolve_port() {
  local key="$1"
  local port _waited=0
  port=$(get_port "$key")
  while is_port_in_use "$port"; do
    warn "Port $port (for $key) is already in use."
    read -rp "  Enter a different port (or press Enter to wait and retry): " _new_port </dev/tty || true
    if [ -n "$_new_port" ]; then
      port="$_new_port"
      save_port "$key" "$port"
      _waited=0
    else
      sleep 2
      if [ "$_waited" -eq 1 ] && is_port_in_use "$port"; then
        local _holder
        _holder=$(lsof -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1 || echo "")
        read -rp "  Still in use${_holder:+ (PID $_holder)}. Kill it? [y/N]: " _kill </dev/tty || true
        case "$_kill" in
          [yY]*) kill "$_holder" 2>/dev/null || true; sleep 1 ;;
        esac
      fi
      _waited=1
    fi
  done
  echo "$port"
}

_zms_port=$(resolve_port zms)
_zts_port=$(resolve_port zts)
_athenz_ui_port=$(resolve_port athenz-ui)
_api_port=$(resolve_port api-server)
_core_mcp_proxy_port=$(resolve_port core-mcp-proxy)
_mcp_port=$(resolve_port mcp)
_confluence_mcp_port=$(resolve_port confluence-mcp)
_idp_port=$(resolve_port keycloak)
_idp_https_port=$(resolve_port keycloak-https)
_ai_client_gateway_port=$(resolve_port ai-client-gateway)
_ai_client_gateway_codex_port=$(resolve_port ai-client-gateway-codex)
_open_webui_port=$(resolve_port open-webui)

_pf() {
  local ns=$1
  local resource=$2
  local local_port=$3
  local remote_port=$4
  while true; do
    kubectl -n "${ns}" port-forward "${resource}" "${local_port}:${remote_port}" 2>/dev/null || true
    sleep 3
  done
}

ok "Port-forwarding started. Press Ctrl+C to stop."
_pf athenz  deployment/athenz-zms-server  "${_zms_port}"               4443 &
_pf athenz  deployment/athenz-zts-server  "${_zts_port}"               4443 &
_pf athenz  deployment/athenz-ui          "${_athenz_ui_port}"         3000 &
_pf api     deployment/api-server         "${_api_port}"               8080 &
_pf mcp-hub service/core-mcp-proxy        "${_core_mcp_proxy_port}"    8080 &
_pf api     service/mcp                   "${_mcp_port}"               8081 &
_pf mcp-hub service/confluence-mcp        "${_confluence_mcp_port}"    9000 &
_pf idp     deployment/keycloak           "${_idp_port}"               8080 &
_pf idp     deployment/keycloak           "${_idp_https_port}"         8443 &
_pf human   service/ai-client-gateway       "${_ai_client_gateway_port}"       3101 &
_pf human   service/ai-client-gateway-codex "${_ai_client_gateway_codex_port}" 3101 &
_pf ai      service/open-webui            "${_open_webui_port}"        8080 &

wait
