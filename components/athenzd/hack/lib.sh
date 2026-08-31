#!/usr/bin/env bash
# Shared output helpers for athenzd hack scripts.
# Source this file: source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

info()  { echo "$@"; }
ok()    { echo "OK — $*"; }
warn()  { echo "⚠  $*"; }
fail()  { echo "ERROR: $*" >&2; exit 1; }

box() {
  local line
  local width=72
  local border
  border=$(printf '═%.0s' $(seq 1 $width))
  echo "╔${border}╗"
  while IFS= read -r line; do
    printf "║  %-${width}s║\n" "$line"
  done <<< "$@"
  echo "╚${border}╝"
}
