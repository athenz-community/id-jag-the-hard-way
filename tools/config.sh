#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$TOOLS_DIR/config.yaml"
LOCAL_CONFIG="$TOOLS_DIR/config.local.yaml"

SECTION="${1:-}"
SUBSECTION=""
KEY=""

case "$#" in
  2)
    KEY="$2"
    ;;
  3)
    SUBSECTION="$2"
    KEY="$3"
    ;;
  *)
    echo "Usage: $0 <section> [subsection] <key>" >&2
    exit 1
    ;;
esac

if [ -z "$SECTION" ] || [ -z "$KEY" ]; then
  echo "Usage: $0 <section> [subsection] <key>" >&2
  exit 1
fi

read_value() {
  local config_file="$1"

  awk \
    -v section="$SECTION" \
    -v subsection="$SUBSECTION" \
    -v key="$KEY" '
      $0 == section ":" {
        in_section = 1
        next
      }

      in_section && /^[^ ]/ {
        exit
      }

      subsection == "" && in_section && index($0, "  " key ":") == 1 {
        value = substr($0, length("  " key ":") + 1)
        sub(/^[[:space:]]+/, "", value)
        print value
        exit
      }

      subsection != "" && in_section && $0 == "  " subsection ":" {
        in_subsection = 1
        next
      }

      in_subsection && /^  [^ ]/ {
        exit
      }

      in_subsection && index($0, "    " key ":") == 1 {
        value = substr($0, length("    " key ":") + 1)
        sub(/^[[:space:]]+/, "", value)
        print value
        exit
      }
    ' "$config_file"
}

local_val=""
[ -f "$LOCAL_CONFIG" ] && local_val=$(read_value "$LOCAL_CONFIG" 2>/dev/null || true)

if [ -n "$local_val" ]; then
  echo "$local_val"
else
  read_value "$CONFIG"
fi
