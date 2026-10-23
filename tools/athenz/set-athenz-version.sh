#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"

# Keep the Python planner's messages consistent with the other IDTHW tools.
python3 -B "${TOOLS_DIR}/athenz/athenz_version.py" "$@" |
  while IFS=$'\t' read -r level message; do
    case "${level}" in
      info) info "${message}" ;;
      ok) ok "${message}" ;;
      warn) warn "${message}" ;;
      err) err "${message}" ;;
      *) printf '%s\n' "${level}${message:+$'\t'${message}}" ;;
    esac
  done
