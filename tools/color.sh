#!/usr/bin/env bash
# Shared output helpers. Source this file — do not execute directly.
#
#   source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/color.sh"   # from tools/
#   source "${TOOLS_DIR}/color.sh"                                      # from tools/athenz/

BOLD="\033[1m"; DIM="\033[2m"; RESET="\033[0m"
GREEN="\033[32m"; YELLOW="\033[33m"; CYAN="\033[36m"; RED="\033[31m"

# step "header"       — bold cyan  ▶  section header (stdout)
# ok   "message"      — green      ✔  success confirmation (stdout)
# info "message"      — dim        ·  neutral progress note (stdout)
# warn "message"      — yellow     ⚠  non-fatal warning (stderr)
# err  "message"      — red        ✘  error, caller decides whether to exit (stderr)
# fatal "message"     — red bold   ✘  print error and exit 1 (stderr)

step()  { printf "\n${BOLD}${CYAN}▶ %s${RESET}\n" "$*"; }
ok()    { printf "  ${GREEN}✔${RESET}  %s\n" "$*"; }
info()  { printf "  ${DIM}·${RESET}  %s\n" "$*"; }
warn()  { printf "  ${YELLOW}⚠${RESET}  %s\n" "$*" >&2; }
err()   { printf "  ${RED}✘${RESET}  %s\n" "$*" >&2; }
fatal() { printf "\n${RED}${BOLD}✘ %s${RESET}\n\n" "$*" >&2; exit 1; }
