#!/usr/bin/env bash
# Checks that every mapstructure field in config.go is referenced in TestLoad_Valid.
# Run via `make test`. Add new fields to config.go? Add them to TestLoad_Valid too.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hack/lib.sh
source "$SCRIPT_DIR/lib.sh"
CONFIG="$SCRIPT_DIR/../internal/config/config.go"
TEST="$SCRIPT_DIR/../internal/config/config_test.go"

fail=0

check_field() {
  local field="$1"
  if ! grep -q "\.$field" "$TEST"; then
    echo "MISSING: .${field} in config.go has no assertion in config_test.go"
    fail=1
  fi
}

# Extract exported Go field names from struct definitions in config.go.
while IFS= read -r field; do
  check_field "$field"
done < <(grep -E '^\s+[A-Z][a-zA-Z]+\s' "$CONFIG" | awk '{print $1}')

if [ "$fail" -eq 1 ]; then
  echo ""
  fail "Add the missing fields to TestLoad_Valid in config_test.go."
fi

ok "all config fields are covered in config_test.go"
