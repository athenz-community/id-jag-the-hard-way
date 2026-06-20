#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$TOOLS_DIR/config.yaml"
LOCAL_CONFIG="$TOOLS_DIR/config.local.yaml"

get_port() {
  local name="$1"
  local local_val=""
  [ -f "$LOCAL_CONFIG" ] && local_val=$(grep "  ${name}:" "$LOCAL_CONFIG" 2>/dev/null | awk '{print $2}' || true)
  if [ -n "$local_val" ]; then
    echo "$local_val"
  else
    grep "  ${name}:" "$CONFIG" | awk '{print $2}'
  fi
}

URL="${1:-}"
_raw_incognito="${2:-false}"
INCOGNITO="${_raw_incognito#incognito=}"

if [ -z "$URL" ]; then
  echo "Usage: $0 <url> [incognito=true|false]"
  exit 1
fi

open_browser() {
  local url="$1"
  local incognito="$2"
  local os
  os="$(uname -s 2>/dev/null || echo "unknown")"

  case "$os" in
    Darwin)
      if [ "$incognito" = "true" ]; then
        if open -Ra "Google Chrome" 2>/dev/null; then
          open -na "Google Chrome" --args --incognito "$url"
        elif open -Ra "Firefox" 2>/dev/null; then
          open -na "Firefox" --args --private-window "$url"
        else
          open -na "Safari" --args --private "$url" 2>/dev/null || open "$url"
        fi
      else
        open "$url"
      fi
      ;;
    Linux)
      if [ "$incognito" = "true" ]; then
        if command -v google-chrome &>/dev/null; then
          google-chrome --incognito "$url" &
        elif command -v chromium-browser &>/dev/null; then
          chromium-browser --incognito "$url" &
        elif command -v firefox &>/dev/null; then
          firefox --private-window "$url" &
        else
          xdg-open "$url" &
        fi
      else
        if command -v xdg-open &>/dev/null; then
          xdg-open "$url" &
        elif command -v google-chrome &>/dev/null; then
          google-chrome "$url" &
        elif command -v firefox &>/dev/null; then
          firefox "$url" &
        else
          echo "No browser found. Please open manually: $url"
          exit 1
        fi
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT)
      if [ "$incognito" = "true" ]; then
        start "" "chrome" --incognito "$url" 2>/dev/null || \
        start "" "msedge" --inprivate "$url" 2>/dev/null || \
        start "" "firefox" --private-window "$url" 2>/dev/null || \
        start "" "$url"
      else
        start "" "$url"
      fi
      ;;
    *)
      echo "Unsupported OS: $os. Please open manually: $url"
      exit 1
      ;;
  esac
}

open_browser "$URL" "$INCOGNITO"
