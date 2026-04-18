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

cat >"$BIN_DIR/launchctl" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >>"${WATCHDOG_TEST_DIR}/launchctl.log"
exit 0
EOF
chmod +x "$BIN_DIR/launchctl"

cat >"$BIN_DIR/curl" <<'EOF'
#!/bin/bash
set -euo pipefail

state_file="${WATCHDOG_TEST_DIR}/curl-count.txt"
count=0
if [[ -f "$state_file" ]]; then
  count=$(cat "$state_file")
fi
count=$((count + 1))
printf '%s' "$count" >"$state_file"

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

scenario="${WATCHDOG_MARKET_DATA_TEST_SCENARIO:-}"

if [[ "$scenario" == "restart" ]]; then
  if [[ "$count" -eq 1 ]]; then
    exit 7
  fi
  if [[ "$url" == *"/market-data/ready" ]]; then
    printf '%s\n' '{"data":{"ready":true,"operatorState":"healthy","operatorAction":"No operator action required."}}' >"$out"
    printf '200'
    exit 0
  fi
  if [[ "$url" == *"/market-data/ops" ]]; then
    printf '%s\n' '{"data":{"serviceOperatorState":"healthy","serviceOperatorAction":"No operator action required."}}' >"$out"
    printf '200'
    exit 0
  fi
  if [[ "$url" == *"/market-data/quote/batch"* ]]; then
    printf '%s\n' '{"data":{"symbols":[]}}' >"$out"
    printf '200'
    exit 0
  fi
fi

if [[ "$scenario" == "cooldown" ]]; then
  if [[ "$url" == *"/market-data/ready" ]]; then
    printf '%s\n' '{"data":{"ready":true,"operatorState":"provider_cooldown","operatorAction":"Wait until cooldown expires."}}' >"$out"
    printf '200'
    exit 0
  fi
  if [[ "$url" == *"/market-data/ops" ]]; then
    printf '%s\n' '{"data":{"serviceOperatorState":"provider_cooldown","serviceOperatorAction":"Wait until cooldown expires."}}' >"$out"
    printf '200'
    exit 0
  fi
  if [[ "$url" == *"/market-data/quote/batch"* ]]; then
    printf '%s\n' '{"error":"cooldown"}' >"$out"
    printf '503'
    exit 0
  fi
fi

if [[ "$scenario" == "cooldown_then_healthy" ]]; then
  if [[ "$count" -le 2 ]]; then
    if [[ "$url" == *"/market-data/ready" ]]; then
      printf '%s\n' '{"data":{"ready":true,"operatorState":"provider_cooldown","operatorAction":"Wait until cooldown expires."}}' >"$out"
      printf '200'
      exit 0
    fi
    if [[ "$url" == *"/market-data/ops" ]]; then
      printf '%s\n' '{"data":{"serviceOperatorState":"provider_cooldown","serviceOperatorAction":"Wait until cooldown expires."}}' >"$out"
      printf '200'
      exit 0
    fi
  else
    if [[ "$url" == *"/market-data/ready" ]]; then
      printf '%s\n' '{"data":{"ready":true,"operatorState":"healthy","operatorAction":"No operator action required."}}' >"$out"
      printf '200'
      exit 0
    fi
    if [[ "$url" == *"/market-data/ops" ]]; then
      printf '%s\n' '{"data":{"serviceOperatorState":"healthy","serviceOperatorAction":"No operator action required."}}' >"$out"
      printf '200'
      exit 0
    fi
    if [[ "$url" == *"/market-data/quote/batch"* ]]; then
      printf '%s\n' '{"data":{"symbols":[]}}' >"$out"
      printf '200'
      exit 0
    fi
  fi
fi

if [[ "$scenario" == "quote_flap" ]]; then
  if [[ "$url" == *"/market-data/ready" ]]; then
    printf '%s\n' '{"data":{"ready":true,"operatorState":"healthy","operatorAction":"No operator action required."}}' >"$out"
    printf '200'
    exit 0
  fi
  if [[ "$url" == *"/market-data/ops" ]]; then
    printf '%s\n' '{"data":{"serviceOperatorState":"healthy","serviceOperatorAction":"No operator action required."}}' >"$out"
    printf '200'
    exit 0
  fi
  if [[ "$url" == *"/market-data/quote/batch"* ]]; then
    printf '%s\n' '{"error":"quote_unavailable"}' >"$out"
    printf '503'
    exit 0
  fi
fi

if [[ "$scenario" == "quote_cooldown" ]]; then
  if [[ "$url" == *"/market-data/ready" ]]; then
    printf '%s\n' '{"data":{"ready":true,"operatorState":"healthy","operatorAction":"No operator action required."}}' >"$out"
    printf '200'
    exit 0
  fi
  if [[ "$url" == *"/market-data/ops" ]]; then
    printf '%s\n' '{"data":{"serviceOperatorState":"healthy","serviceOperatorAction":"No operator action required."}}' >"$out"
    printf '200'
    exit 0
  fi
  if [[ "$url" == *"/market-data/quote/batch"* ]]; then
    printf '%s\n' '{"source":"service","status":"error","degradedReason":"2 batch item(s) failed","data":{"items":[{"symbol":"SPY","degradedReason":"Schwab REST cooldown open until 2026-04-03T20:16:32.529Z"},{"symbol":"QQQ","degradedReason":"Schwab REST cooldown open until 2026-04-03T20:16:32.529Z"}]}}' >"$out"
    printf '503'
    exit 0
  fi
fi

printf '000'
EOF
chmod +x "$BIN_DIR/curl"

run_scenario() {
  local scenario="$1"
  local scenario_dir="$TMP_DIR/$scenario"
  mkdir -p "$scenario_dir"
  local weekday_override="${WATCHDOG_TEST_WEEKDAY_OVERRIDE:-3}"
  rm -f "$scenario_dir/launchctl.log" "$scenario_dir/output.txt"
  PATH="$BIN_DIR:$PATH" \
  STATE_FILE="$scenario_dir/state.json" \
  WATCHDOG_TEST_DIR="$scenario_dir" \
  WATCHDOG_MARKET_DATA_TEST_SCENARIO="$scenario" \
  MARKET_DATA_BASE_URL="http://localhost:3033" \
  MARKET_DATA_RESTART_WAIT_SECONDS=0 \
  MARKET_DATA_ADVISORY_THRESHOLD_SECONDS=0 \
  WATCHDOG_MARKET_DATA_WEEKDAY="$weekday_override" \
  bash -c "source '$ROOT_DIR/watchdog.sh'; PATH='$BIN_DIR':\"\$PATH\"; ALERTS=''; LOGS=''; check_market_data_health; printf '%s' \"\$ALERTS\" >'$scenario_dir/output.txt'"
}

run_scenario restart
assert_file_contains "restart/unreachable triggers watchdog restart" "kickstart -k gui/" "$TMP_DIR/restart/launchctl.log"
assert_file_contains "restart/success emits restart alert" "Market-data service was unreachable and watchdog restarted it successfully" "$TMP_DIR/restart/output.txt"

run_scenario cooldown
assert_file_empty "cooldown first occurrence stays silent" "$TMP_DIR/cooldown/output.txt"
run_scenario cooldown
assert_file_contains "cooldown warns without restart" "Schwab market data is in a brief cooldown" "$TMP_DIR/cooldown/output.txt"
assert_file_empty "cooldown does not restart service" "$TMP_DIR/cooldown/launchctl.log"

run_scenario cooldown_then_healthy
assert_file_empty "brief cooldown first occurrence stays silent" "$TMP_DIR/cooldown_then_healthy/output.txt"
run_scenario cooldown_then_healthy
assert_file_empty "brief cooldown recovery stays silent" "$TMP_DIR/cooldown_then_healthy/output.txt"

run_scenario quote_flap
assert_file_empty "quote smoke first failure stays silent" "$TMP_DIR/quote_flap/output.txt"
run_scenario quote_flap
assert_file_contains "quote smoke sustained failure alerts after restart attempt" "Market-data quote smoke test still failing after automatic restart" "$TMP_DIR/quote_flap/output.txt"
assert_file_contains "quote smoke sustained failure triggers restart attempt" "kickstart -k gui/" "$TMP_DIR/quote_flap/launchctl.log"

run_scenario quote_cooldown
assert_file_empty "quote cooldown first failure stays silent" "$TMP_DIR/quote_cooldown/output.txt"
run_scenario quote_cooldown
assert_file_contains "quote cooldown reuses provider advisory" "Schwab market data is in a brief cooldown" "$TMP_DIR/quote_cooldown/output.txt"
assert_file_empty "quote cooldown does not restart service" "$TMP_DIR/quote_cooldown/launchctl.log"

WATCHDOG_TEST_WEEKDAY_OVERRIDE=6
run_scenario quote_flap
assert_file_empty "weekend quote smoke stays silent" "$TMP_DIR/quote_flap/output.txt"
assert_file_empty "weekend quote smoke does not restart service" "$TMP_DIR/quote_flap/launchctl.log"
unset WATCHDOG_TEST_WEEKDAY_OVERRIDE

echo "All market-data watchdog tests passed."
