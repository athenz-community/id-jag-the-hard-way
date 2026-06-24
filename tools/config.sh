#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$TOOLS_DIR/config.yaml"
LOCAL_CONFIG="$TOOLS_DIR/config.local.yaml"

SECTION="${1:-}"
KEY="${2:-}"

if [ -z "$SECTION" ] || [ -z "$KEY" ]; then
  echo "Usage: $0 <section> <key>" >&2
  exit 1
fi

local_val=""
[ -f "$LOCAL_CONFIG" ] && local_val=$(awk "/^${SECTION}:/{f=1;next} f && /^[^ ]/{f=0} f && /^  ${KEY}:/{print \$2}" "$LOCAL_CONFIG" 2>/dev/null || true)

if [ -n "$local_val" ]; then
  echo "$local_val"
else
  awk "/^${SECTION}:/{f=1;next} f && /^[^ ]/{f=0} f && /^  ${KEY}:/{print \$2}" "$CONFIG"
fi
