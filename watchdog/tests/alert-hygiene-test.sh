#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; exit 1; }
assert_file_contains() {
  local name="$1"
  local needle="$2"
  local file_path="$3"
  if grep -Fq "$needle" "$file_path"; then
    pass "$name"
  else
    fail "$name (missing '$needle' in $file_path)"
  fi
}
assert_file_not_contains() {
  local name="$1"
  local needle="$2"
  local file_path="$3"
  if grep -Fq "$needle" "$file_path"; then
    fail "$name (unexpected '$needle' in $file_path)"
  else
    pass "$name"
  fi
}

LOG_FILE="$TMP_DIR/log.txt"
STATE_FILE="$TMP_DIR/state.json"

source "$ROOT_DIR/watchdog.sh"

log() {
  local severity="$1" msg="$2" meta="${3:-}"
  printf '%s|%s|%s
' "$severity" "$msg" "$meta" >>"$LOG_FILE"
}

ALERTS=""
alert "gog smoke test failed (exit 1)" "gog" "warning"
: >"$LOG_FILE"
ALERTS=""
alert "gog smoke test failed (exit 1)" "gog" "warning"
assert_file_contains "suppressed alert logs check identity" "Suppressed repeated alert for gog" "$LOG_FILE"
assert_file_not_contains "suppressed alert omits stale failure text" "gog smoke test failed" "$LOG_FILE"

rm -f "$STATE_FILE"
: >"$LOG_FILE"
alert_if_failure_persists "market_data_provider" 3600 "Schwab market data is in a brief cooldown. Live trading data may be temporarily degraded." "warning" || true
assert_file_contains "deferred alert logs generic message" "Deferred alert for market_data_provider until failure persists" "$LOG_FILE"
assert_file_not_contains "deferred alert omits raw failure text" "Schwab market data is in a brief cooldown" "$LOG_FILE"

echo "All watchdog alert hygiene tests passed."
