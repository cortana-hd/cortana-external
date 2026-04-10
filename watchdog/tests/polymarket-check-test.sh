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

assert_file_empty() {
  local name="$1"
  local file_path="$2"
  if [[ ! -s "$file_path" ]]; then
    pass "$name"
  else
    fail "$name (expected empty $file_path)"
  fi
}

BIN_DIR="$TMP_DIR/bin"
mkdir -p "$BIN_DIR"

cat >"$BIN_DIR/psql" <<'EOF'
#!/bin/bash
exit 0
EOF
chmod +x "$BIN_DIR/psql"

cat >"$BIN_DIR/gog" <<'EOF'
#!/bin/bash
exit 0
EOF
chmod +x "$BIN_DIR/gog"

cat >"$BIN_DIR/curl" <<'EOF'
#!/bin/bash
set -euo pipefail

out=""
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o)
      out="$2"
      shift 2
      ;;
    -w)
      shift 2
      ;;
    --max-time)
      shift 2
      ;;
    -s|-S|-sS)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done

scenario="${WATCHDOG_POLYMARKET_TEST_SCENARIO:-}"

if [[ "$url" == *"/polymarket/health" ]]; then
  case "$scenario" in
    healthy)
      printf '%s\n' '{"status":"healthy","apiBaseUrl":"https://api.polymarket.us","gatewayBaseUrl":"https://gateway.polymarket.us","keyIdSuffix":"106dac","balanceCount":0}' >"$out"
      printf '200'
      exit 0
      ;;
    degraded)
      printf '%s\n' '{"status":"degraded","error":"Too many requests"}' >"$out"
      printf '200'
      exit 0
      ;;
    unhealthy)
      printf '%s\n' '{"status":"unhealthy","error":"Invalid credentials"}' >"$out"
      printf '200'
      exit 0
      ;;
    unconfigured)
      printf '%s\n' '{"status":"unconfigured","error":"polymarket credentials are not configured"}' >"$out"
      printf '200'
      exit 0
      ;;
    unreachable)
      exit 7
      ;;
  esac
fi

printf '000'
EOF
chmod +x "$BIN_DIR/curl"

run_scenario() {
  local scenario="$1"
  local scenario_dir="$TMP_DIR/$scenario"
  mkdir -p "$scenario_dir"
  PATH="$BIN_DIR:$PATH" \
  STATE_FILE="$scenario_dir/state.json" \
  WATCHDOG_POLYMARKET_TEST_SCENARIO="$scenario" \
  FITNESS_BASE_URL="http://localhost:3033" \
  POLYMARKET_ADVISORY_THRESHOLD_SECONDS=0 \
  bash -c "source '$ROOT_DIR/watchdog.sh'; PATH='$BIN_DIR':\"\$PATH\"; ALERTS=''; LOGS=''; check_polymarket_health; printf '%s' \"\$ALERTS\" >'$scenario_dir/output.txt'"
}

run_scenario healthy
assert_file_empty "healthy polymarket stays silent" "$TMP_DIR/healthy/output.txt"

run_scenario degraded
assert_file_empty "degraded first occurrence stays silent" "$TMP_DIR/degraded/output.txt"
run_scenario degraded
assert_file_contains "degraded sustained failure alerts" "Polymarket is degraded. Polymarket US API rate limit is active." "$TMP_DIR/degraded/output.txt"

run_scenario unconfigured
assert_file_contains "unconfigured alerts immediately" "Polymarket is unconfigured. Polymarket credentials are not configured in the external service." "$TMP_DIR/unconfigured/output.txt"

run_scenario unhealthy
assert_file_contains "unhealthy alerts immediately" "Polymarket is unhealthy. Polymarket credentials need operator attention." "$TMP_DIR/unhealthy/output.txt"

run_scenario unreachable
assert_file_contains "unreachable endpoint alerts immediately" "Polymarket health endpoint is unreachable" "$TMP_DIR/unreachable/output.txt"

echo "All Polymarket watchdog tests passed."
