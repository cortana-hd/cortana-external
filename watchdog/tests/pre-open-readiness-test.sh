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

write_canary_artifact() {
  local output_path="$1"
  local result="$2"
  local outcome_class="$3"
  local status="$4"
  local degraded_status="$5"
  local checks_json="$6"
  local checked_at="$7"
  python3 - "$output_path" "$result" "$outcome_class" "$status" "$degraded_status" "$checks_json" "$checked_at" <<'PY'
from __future__ import annotations

import json
from pathlib import Path
import sys

output_path = Path(sys.argv[1])
result = sys.argv[2]
outcome_class = sys.argv[3]
status = sys.argv[4]
degraded_status = sys.argv[5]
checks = json.loads(sys.argv[6])
checked_at = sys.argv[7]

payload = {
    "artifact_family": "readiness_check",
    "schema_version": 1,
    "producer": "backtester.pre_open_canary",
    "status": status,
    "degraded_status": degraded_status,
    "outcome_class": outcome_class,
    "generated_at": checked_at,
    "known_at": checked_at,
    "check_name": "pre_open_canary",
    "result": result,
    "ready_for_open": result == "pass",
    "checked_at": checked_at,
    "checks": checks,
    "warnings": [],
}
output_path.write_text(json.dumps(payload), encoding="utf-8")
PY
}

run_scenario() {
  local scenario="$1"
  local scenario_dir="$TMP_DIR/$scenario"
  mkdir -p "$scenario_dir"
  PATH="$BIN_DIR:$PATH" \
  STATE_FILE="$scenario_dir/state.json" \
  PRE_OPEN_CANARY_PATH="$scenario_dir/pre-open-canary-latest.json" \
  PRE_OPEN_CANARY_MAX_AGE_SECONDS=7200 \
  PRE_OPEN_CANARY_WARN_THRESHOLD_SECONDS=0 \
  bash -c "source '$ROOT_DIR/watchdog.sh'; PATH='$BIN_DIR':\"\$PATH\"; ALERTS=''; LOGS=''; check_pre_open_readiness; printf '%s' \"\$ALERTS\" >'$scenario_dir/output.txt'"
}

CURRENT_TS="$(python3 - <<'PY'
from datetime import UTC, datetime
print(datetime.now(UTC).isoformat())
PY
)"

STALE_TS="$(python3 - <<'PY'
from datetime import UTC, datetime, timedelta
print((datetime.now(UTC) - timedelta(hours=6)).isoformat())
PY
)"

provider_only_checks='[
  {"name":"service_ready","result":"warn","evidence":{"reason":"provider_cooldown","operator_action":"Wait until cooldown expires."}},
  {"name":"quote_smoke","result":"warn","evidence":{"error":"503 Server Error: Service Unavailable"}}
]'
mkdir -p "$TMP_DIR/provider_only"
write_canary_artifact \
  "$TMP_DIR/provider_only/pre-open-canary-latest.json" \
  "warn" \
  "readiness_warn" \
  "degraded" \
  "degraded_safe" \
  "$provider_only_checks" \
  "$CURRENT_TS"
run_scenario provider_only
assert_file_empty "provider-only readiness degradation stays silent" "$TMP_DIR/provider_only/output.txt"

strategy_fail_checks='[
  {"name":"service_ready","result":"pass","evidence":{"reason":"healthy"}},
  {"name":"strategy_smoke","result":"fail","evidence":{"error":"scanner blew up"}}
]'
mkdir -p "$TMP_DIR/strategy_fail"
write_canary_artifact \
  "$TMP_DIR/strategy_fail/pre-open-canary-latest.json" \
  "fail" \
  "readiness_fail" \
  "error" \
  "degraded_risky" \
  "$strategy_fail_checks" \
  "$CURRENT_TS"
run_scenario strategy_fail
assert_file_contains "strategy failure alerts immediately" "Pre-open canary failed. Trading lane is not ready for the open." "$TMP_DIR/strategy_fail/output.txt"
assert_file_contains "strategy failure explains cause" "Reduced CANSLIM strategy smoke failed." "$TMP_DIR/strategy_fail/output.txt"

strategy_warn_checks='[
  {"name":"service_ready","result":"pass","evidence":{"reason":"healthy"}},
  {"name":"regime_path","result":"warn","evidence":{"degraded_reason":"cached fallback"}}
]'
mkdir -p "$TMP_DIR/strategy_warn"
write_canary_artifact \
  "$TMP_DIR/strategy_warn/pre-open-canary-latest.json" \
  "warn" \
  "readiness_warn" \
  "degraded" \
  "degraded_safe" \
  "$strategy_warn_checks" \
  "$CURRENT_TS"
run_scenario strategy_warn
assert_file_empty "first strategy warning stays silent" "$TMP_DIR/strategy_warn/output.txt"
run_scenario strategy_warn
assert_file_contains "sustained strategy warning alerts" "Pre-open canary is degraded. Trading lane may not be fully ready for the open." "$TMP_DIR/strategy_warn/output.txt"
assert_file_contains "strategy warning explains cause" "Live market regime path is degraded." "$TMP_DIR/strategy_warn/output.txt"

pass_checks='[
  {"name":"service_ready","result":"pass","evidence":{"reason":"healthy"}},
  {"name":"quote_smoke","result":"pass","evidence":{}}
]'
write_canary_artifact \
  "$TMP_DIR/strategy_warn/pre-open-canary-latest.json" \
  "pass" \
  "readiness_pass" \
  "ok" \
  "healthy" \
  "$pass_checks" \
  "$CURRENT_TS"
run_scenario strategy_warn
assert_file_contains "recovery emits after alerted strategy warning" "Pre-open canary recovered and the trading lane is ready for the open" "$TMP_DIR/strategy_warn/output.txt"

mkdir -p "$TMP_DIR/stale"
write_canary_artifact \
  "$TMP_DIR/stale/pre-open-canary-latest.json" \
  "fail" \
  "readiness_fail" \
  "error" \
  "degraded_risky" \
  "$strategy_fail_checks" \
  "$STALE_TS"
run_scenario stale
assert_file_empty "stale readiness artifact stays silent" "$TMP_DIR/stale/output.txt"

echo "All pre-open readiness watchdog tests passed."
