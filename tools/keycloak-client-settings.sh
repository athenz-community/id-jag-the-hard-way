#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
port=$("$TOOLS_DIR/port.sh" ai-client-gateway)

redirect_uri="http://localhost:${port}/oauth/callback"
web_origin="http://localhost:${port}"

hr() {
  local c1=$1 c2=$2
  printf '+'; printf '%0.s-' $(seq 1 $((c1+2)))
  printf '+'; printf '%0.s-' $(seq 1 $((c2+2))); printf '+\n'
}
row() {
  local c1=$1 c2=$2
  printf '| %-*s | %-*s |\n' "$c1" "$3" "$c2" "$4"
}
section() { printf '\n%s\n' "$1"; }

# Step 1
c1=11; c2=41
section "Step 1: General Settings"
hr $c1 $c2
row $c1 $c2 "Field" "Value"
hr $c1 $c2
row $c1 $c2 "Client type" "OpenID Connect (no change)"
row $c1 $c2 "Client ID"   "human.idjag-learner.claude"
row $c1 $c2 "Name"        "human.idjag-learner.claude"
row $c1 $c2 "Description" "Local Claude Code for human.idjag-learner"
hr $c1 $c2

# Step 2
c1=21; c2=5
section "Step 2: Capability Config"
hr $c1 $c2
row $c1 $c2 "Field" "Value"
hr $c1 $c2
row $c1 $c2 "Client authentication" "ON"
hr $c1 $c2

# Step 3
c1=19; c2=${#redirect_uri}
section "Step 3: Login Settings"
hr $c1 $c2
row $c1 $c2 "Field" "Value"
hr $c1 $c2
row $c1 $c2 "Valid redirect URIs" "$redirect_uri"
row $c1 $c2 "Web origins"        "$web_origin"
hr $c1 $c2
