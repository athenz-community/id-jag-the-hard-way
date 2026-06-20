#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$TOOLS_DIR/config.yaml"
LOCAL_CONFIG="$TOOLS_DIR/config.local.yaml"

NAME="${1:-}"

if [ -z "$NAME" ]; then
  echo "Usage: $0 <port-name>" >&2
  exit 1
fi

local_val=""
[ -f "$LOCAL_CONFIG" ] && local_val=$(grep "  ${NAME}:" "$LOCAL_CONFIG" 2>/dev/null | awk '{print $2}' || true)

if [ -n "$local_val" ]; then
  echo "$local_val"
else
  grep "  ${NAME}:" "$CONFIG" | awk '{print $2}'
fi
