#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$TOOLS_DIR/config.yaml"
LOCAL_CONFIG="$TOOLS_DIR/config.local.yaml"

VALID_KEYS=(
  port-zms
  port-zts
  port-athenz-ui
  port-api-server
  port-mcp
  port-keycloak
  port-ai-client-gateway
  port-open-webui
)

usage() {
  echo "Usage: $0 <key>"
  echo ""
  echo "Available keys:"
  for k in "${VALID_KEYS[@]}"; do
    echo "  $k"
  done
  exit 1
}

get_default() {
  local name="${1#port-}"
  grep "  ${name}:" "$CONFIG" | awk '{print $2}'
}

get_local() {
  local name="${1#port-}"
  [ -f "$LOCAL_CONFIG" ] && grep "  ${name}:" "$LOCAL_CONFIG" 2>/dev/null | awk '{print $2}' || echo ""
}

set_local() {
  local name="${1#port-}"
  local value="$2"

  if [ ! -f "$LOCAL_CONFIG" ]; then
    echo "ports:" > "$LOCAL_CONFIG"
  fi

  if grep -q "  ${name}:" "$LOCAL_CONFIG" 2>/dev/null; then
    sed -i '' "s|  ${name}:.*|  ${name}: ${value}|" "$LOCAL_CONFIG"
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

prompt_port() {
  local KEY="$1"
  local default current display input

  default=$(get_default "$KEY")
  current=$(get_local "$KEY")
  display="${current:-$default}"

  while true; do
    read -rp "Which port would you like to use for ${KEY#port-}? [Hit Enter for default: $display]: " input
    input="${input:-$display}"

    if is_port_in_use "$input"; then
      echo "⚠️  Port $input is already in use. Please choose a different port."
      display="$input"
      continue
    fi

    break
  done

  if [ "$input" = "$default" ]; then
    [ -f "$LOCAL_CONFIG" ] && sed -i '' "/  ${KEY#port-}:/d" "$LOCAL_CONFIG"
    echo "Using default port $input for ${KEY#port-}."
  else
    set_local "$KEY" "$input"
    echo "Saved port $input for ${KEY#port-} to config.local.yaml."
  fi
}

KEY="${1:-}"

if [ -z "$KEY" ]; then
  usage
fi

if [ "$KEY" = "port" ]; then
  for k in "${VALID_KEYS[@]}"; do
    prompt_port "$k"
  done
  exit 0
fi

valid=false
for k in "${VALID_KEYS[@]}"; do
  [ "$k" = "$KEY" ] && valid=true && break
done
if [ "$valid" = false ]; then
  echo "Unknown key: $KEY"
  usage
fi

prompt_port "$KEY"
