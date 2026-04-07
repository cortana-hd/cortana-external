#!/bin/bash
# Cortana Watchdog — runs every 15 min via launchd
# Pure shell, $0 cost, no AI involved

set -euo pipefail

export PATH="/opt/homebrew/bin:/opt/homebrew/opt/postgresql@17/bin:/usr/local/bin:/usr/bin:/bin"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/heartbeat_classifier.sh"

BOT_TOKEN="$(jq -r '.channels.telegram.accounts.monitor.botToken // .channels.telegram.botToken // .channels.telegram.accounts.default.botToken // empty' /Users/hd/.openclaw/openclaw.json 2>/dev/null)"
CHAT_ID="8171372724"
SLACK_WEBHOOK_URL="${WATCHDOG_SLACK_WEBHOOK_URL:-}"
ALERTS=""
LOGS=""
STATE_FILE="${STATE_FILE:-$SCRIPT_DIR/watchdog-state.json}"
FITNESS_BASE_URL="${FITNESS_BASE_URL:-http://localhost:3033}"
MARKET_DATA_BASE_URL="${MARKET_DATA_BASE_URL:-$FITNESS_BASE_URL}"
MARKET_DATA_LAUNCHD_LABEL="${MARKET_DATA_LAUNCHD_LABEL:-com.cortana.fitness-service}"
MARKET_DATA_RESTART_WAIT_SECONDS="${MARKET_DATA_RESTART_WAIT_SECONDS:-8}"
MARKET_DATA_QUOTE_SYMBOLS="${MARKET_DATA_QUOTE_SYMBOLS:-SPY,QQQ}"
PRE_OPEN_CANARY_PATH="${PRE_OPEN_CANARY_PATH:-/Users/hd/Developer/cortana-external/backtester/var/readiness/pre-open-canary-latest.json}"
PRE_OPEN_CANARY_MAX_AGE_SECONDS="${PRE_OPEN_CANARY_MAX_AGE_SECONDS:-7200}"
PRE_OPEN_CANARY_WARN_THRESHOLD_SECONDS="${PRE_OPEN_CANARY_WARN_THRESHOLD_SECONDS:-900}"
MISSION_CONTROL_BASE_URL="${MISSION_CONTROL_BASE_URL:-http://127.0.0.1:3000}"
MISSION_CONTROL_HEALTH_PATH="${MISSION_CONTROL_HEALTH_PATH:-/api/heartbeat-status}"
MISSION_CONTROL_LAUNCHD_LABEL="${MISSION_CONTROL_LAUNCHD_LABEL:-com.cortana.mission-control}"
MISSION_CONTROL_RESTART_WAIT_SECONDS="${MISSION_CONTROL_RESTART_WAIT_SECONDS:-8}"
GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
GATEWAY_LABEL="${OPENCLAW_LAUNCHD_LABEL:-ai.openclaw.gateway}"
CORTANA_SOURCE_REPO="${CORTANA_SOURCE_REPO:-/Users/hd/Developer/cortana}"
TELEGRAM_USAGE_HANDLER_PATH="${TELEGRAM_USAGE_HANDLER_PATH:-$CORTANA_SOURCE_REPO/skills/telegram-usage/handler.ts}"
DEFAULT_REPO_HEARTBEAT_STATE_FILE="$CORTANA_SOURCE_REPO/memory/heartbeat-state.json"
LEGACY_HEARTBEAT_STATE_FILE="$HOME/.openclaw/memory/heartbeat-state.json"
HEARTBEAT_STATE_FILE="${HEARTBEAT_STATE_FILE:-$DEFAULT_REPO_HEARTBEAT_STATE_FILE}"
if [[ ! -f "$HEARTBEAT_STATE_FILE" && -f "$LEGACY_HEARTBEAT_STATE_FILE" ]]; then
  HEARTBEAT_STATE_FILE="$LEGACY_HEARTBEAT_STATE_FILE"
fi
OPENCLAW_GATEWAY_PLIST="${OPENCLAW_GATEWAY_PLIST:-$HOME/Library/LaunchAgents/ai.openclaw.gateway.plist}"
OPENCLAW_GATEWAY_ENV_STATE_PATH="${OPENCLAW_GATEWAY_ENV_STATE_PATH:-$HOME/.openclaw/state/gateway-env.json}"

load_gog_keyring_password_from_openclaw_runtime() {
  if [[ -n "${GOG_KEYRING_PASSWORD:-}" ]]; then
    export GOG_KEYRING_PASSWORD
    return 0
  fi

  if [[ -f "$OPENCLAW_GATEWAY_ENV_STATE_PATH" ]]; then
    GOG_KEYRING_PASSWORD="$(jq -r '.GOG_KEYRING_PASSWORD // empty' "$OPENCLAW_GATEWAY_ENV_STATE_PATH" 2>/dev/null || true)"
  fi

  if [[ -z "${GOG_KEYRING_PASSWORD:-}" && -f "$OPENCLAW_GATEWAY_PLIST" ]]; then
    GOG_KEYRING_PASSWORD="$(plutil -extract EnvironmentVariables.GOG_KEYRING_PASSWORD raw -o - "$OPENCLAW_GATEWAY_PLIST" 2>/dev/null || true)"
  fi

  if [[ -n "${GOG_KEYRING_PASSWORD:-}" ]]; then
    export GOG_KEYRING_PASSWORD
    return 0
  fi

  return 1
}

load_gog_keyring_password_from_openclaw_runtime || true

# ── State Management ──
load_state() {
  if [[ -f "$STATE_FILE" ]]; then
    cat "$STATE_FILE" 2>/dev/null || echo '{}'
  else
    echo '{}'
  fi
}

save_state() {
  local state="$1"
  echo "$state" > "$STATE_FILE" 2>/dev/null || true
}

get_current_timestamp() {
  date +%s
}

# Get the last alert time for a specific check
get_last_alert_time() {
  local check_name="$1"
  local state=$(load_state)
  echo "$state" | jq -r ".\"$check_name\".last_alert // 0" 2>/dev/null || echo "0"
}

# Get the first failure time for a specific check
get_first_failure_time() {
  local check_name="$1"
  local state=$(load_state)
  echo "$state" | jq -r ".\"$check_name\".first_failure // 0" 2>/dev/null || echo "0"
}

get_check_status() {
  local check_name="$1"
  local state=$(load_state)
  echo "$state" | jq -r ".\"$check_name\".status // \"unknown\"" 2>/dev/null || echo "unknown"
}

get_check_last_recovery_time() {
  local check_name="$1"
  local state=$(load_state)
  echo "$state" | jq -r ".\"$check_name\".last_recovery // 0" 2>/dev/null || echo "0"
}

# Update state for a check
update_check_state() {
  local check_name="$1"
  local status="$2"  # "failing" or "recovered"
  local current_time=$(get_current_timestamp)
  local state=$(load_state)

  if [[ "$status" == "failing" ]]; then
    local first_failure=$(get_first_failure_time "$check_name")
    if [[ "$first_failure" == "0" ]]; then
      first_failure="$current_time"
    fi
    state=$(echo "$state" | jq --arg check "$check_name" --argjson time "$current_time" --argjson first "$first_failure" \
      '.[$check] = {last_alert: $time, first_failure: $first, status: "failing"}')
  else
    # Clear failure state on recovery
    state=$(echo "$state" | jq --arg check "$check_name" --argjson time "$current_time" \
      '.[$check] = {last_alert: 0, first_failure: 0, status: "recovered", last_recovery: $time}')
  fi

  save_state "$state"
}

begin_check_failure_grace_period() {
  local check_name="$1"
  local current_time
  current_time=$(get_current_timestamp)
  local state
  state=$(load_state)
  local first_failure
  first_failure=$(echo "$state" | jq -r ".\"$check_name\".first_failure // 0" 2>/dev/null || echo "0")
  if [[ "$first_failure" == "0" ]]; then
    first_failure="$current_time"
  fi
  state=$(echo "$state" | jq --arg check "$check_name" --argjson first "$first_failure" '
    .[$check] = {
      last_alert: (.[$check].last_alert // 0),
      first_failure: $first,
      status: "failing",
      last_recovery: (.[$check].last_recovery // 0)
    }
  ')
  save_state "$state"
}

# Check if we should suppress this alert
should_suppress_alert() {
  local check_name="$1"
  local current_time=$(get_current_timestamp)
  local last_alert=$(get_last_alert_time "$check_name")
  local first_failure=$(get_first_failure_time "$check_name")

  # First occurrence - never suppress
  if [[ "$last_alert" == "0" ]]; then
    return 1  # Don't suppress
  fi

  # Special case for Tonal: if failing >1 hour, only alert every 6 hours
  if [[ "$check_name" == *"Tonal"* ]]; then
    local failure_duration=$((current_time - first_failure))
    if [[ "$failure_duration" -gt 3600 ]]; then  # >1 hour
      local time_since_last=$((current_time - last_alert))
      if [[ "$time_since_last" -lt 21600 ]]; then  # <6 hours
        return 0  # Suppress
      fi
    fi
  fi

  # General suppression: don't repeat identical alerts within 6 hours
  local time_since_last=$((current_time - last_alert))
  if [[ "$time_since_last" -lt 21600 ]]; then  # <6 hours
    return 0  # Suppress
  fi

  return 1  # Don't suppress
}

get_failure_duration_seconds() {
  local check_name="$1"
  local current_time
  current_time=$(get_current_timestamp)
  local first_failure
  first_failure=$(get_first_failure_time "$check_name")
  local check_status
  check_status=$(get_check_status "$check_name")

  if [[ "$check_status" != "failing" || "$first_failure" == "0" ]]; then
    echo "0"
    return
  fi

  echo $((current_time - first_failure))
}

log() {
  local severity="$1" msg="$2" meta="${3:-{}}"
  LOGS="${LOGS}\n[${severity}] ${msg}"
  echo "$(date '+%Y-%m-%d %H:%M:%S') [${severity}] ${msg}"
  psql cortana -c "INSERT INTO cortana_events (event_type, source, severity, message, metadata) VALUES ('watchdog', 'watchdog.sh', '${severity}', '$(echo "$msg" | sed "s/'/''/g")', '$(echo "$meta" | sed "s/'/''/g")');" 2>/dev/null || true
}

alert() {
  local msg="$1"
  local check_name="${2:-$msg}"  # Use msg as check_name if not provided
  local severity="${3:-warning}"

  if should_suppress_alert "$check_name"; then
    log "info" "Suppressed repeated alert for ${check_name}"
    return
  fi

  local icon="⚠️"
  if [[ "$severity" == "critical" ]]; then
    icon="🚨"
  fi

  ALERTS="${ALERTS}${icon} ${msg}\n"
  log "$severity" "$msg"
  update_check_state "$check_name" "failing"
}

# Send recovery alert for a previously failing check
recovery_alert() {
  local check_name="$1"
  local msg="$2"
  local state=$(load_state)
  local check_status=$(echo "$state" | jq -r ".\"$check_name\".status // \"unknown\"" 2>/dev/null || echo "unknown")

  # Only send recovery alert if the check was previously failing
  if [[ "$check_status" == "failing" ]]; then
    ALERTS="${ALERTS}✅ ${msg}\n"
    log "info" "Recovery: $msg"
    update_check_state "$check_name" "recovered"
  fi
}

mark_check_failing_silent() {
  local check_name="$1"
  if [[ "$(get_check_status "$check_name")" != "failing" ]]; then
    begin_check_failure_grace_period "$check_name"
  fi
}

clear_check_recovery_silent() {
  local check_name="$1"
  if [[ "$(get_check_status "$check_name")" == "failing" ]]; then
    update_check_state "$check_name" "recovered"
  fi
}

alert_if_failure_persists() {
  local check_name="$1"
  local threshold_seconds="$2"
  local msg="$3"
  local severity="${4:-warning}"

  if [[ "$(get_check_status "$check_name")" != "failing" ]]; then
    begin_check_failure_grace_period "$check_name"
    log "info" "Deferred alert for ${check_name} until failure persists"
    return 1
  fi

  if [[ "$(get_failure_duration_seconds "$check_name")" -lt "$threshold_seconds" ]]; then
    log "info" "Still waiting for ${check_name} to persist before alerting"
    return 1
  fi

  alert "$msg" "$check_name" "$severity"
}

record_heartbeat_observation() {
  local current_time="$1"
  local pid="$2"
  local age_seconds="$3"
  local state
  state=$(load_state)

  state=$(echo "$state" | jq --argjson now "$current_time" --arg pid "$pid" --argjson age "$age_seconds" '
    .heartbeat_monitor.last_seen_at = $now |
    .heartbeat_monitor.last_pid = $pid |
    .heartbeat_monitor.last_age = $age |
    .heartbeat_monitor.last_status = "observed"
  ')

  save_state "$state"
}

get_heartbeat_monitor_value() {
  local field="$1"
  local state
  state=$(load_state)
  echo "$state" | jq -r ".heartbeat_monitor.${field} // empty" 2>/dev/null || true
}

track_heartbeat_restart() {
  local current_time="$1"
  local state
  state=$(load_state)
  state=$(echo "$state" | jq --argjson now "$current_time" '
    .heartbeat_monitor.restarts = ((.heartbeat_monitor.restarts // []) + [$now])
    | .heartbeat_monitor.restarts = (.heartbeat_monitor.restarts | map(select(. >= ($now - 21600))))
  ')
  save_state "$state"
}

get_heartbeat_restarts_6h() {
  local current_time="$1"
  local state
  state=$(load_state)
  echo "$state" | jq -r --argjson now "$current_time" '
    ((.heartbeat_monitor.restarts // []) | map(select(. >= ($now - 21600))) | length)
  ' 2>/dev/null || echo "0"
}

get_heartbeat_state_age_seconds() {
  local current_time="$1"
  local current_ms=$((current_time * 1000))

  [[ -f "$HEARTBEAT_STATE_FILE" ]] || {
    echo ""
    return
  }

  jq -r --argjson now "$current_ms" '
    def ts(v): if (v | type) == "number" then v else 0 end;
    def max_check: ((.lastChecks // {}) | to_entries | map(.value.lastChecked // 0) | max // 0);
    [ts(.lastHeartbeat), max_check] | max as $last |
    if $last > 0 and $now >= $last then (($now - $last) / 1000 | floor) else empty end
  ' "$HEARTBEAT_STATE_FILE" 2>/dev/null || echo ""
}

send_alert_notifications() {
  local msg="$1"

  # canonical channel in this repo is Telegram via OpenClaw bot token
  "$SCRIPT_DIR/send_telegram.sh" "$BOT_TOKEN" "$CHAT_ID" "$msg"

  # optional Slack bridge (if explicitly configured)
  if [[ -n "$SLACK_WEBHOOK_URL" ]]; then
    curl -s -X POST -H 'Content-type: application/json' \
      --data "$(jq -nc --arg text "$(echo -e "$msg" | sed 's/\*//g')" '{text:$text}')" \
      "$SLACK_WEBHOOK_URL" >/dev/null || true
  fi
}

attempt_launchd_restart() {
  local label="$1"
  local wait_seconds="${2:-8}"
  local uid
  uid=$(id -u)
  local target="gui/${uid}/${label}"
  if ! launchctl kickstart -k "$target" >/dev/null 2>&1; then
    return 1
  fi
  sleep "$wait_seconds"
  return 0
}

probe_json_endpoint() {
  local url="$1"
  local body_path="$2"
  curl -sS --max-time 15 -o "$body_path" -w '%{http_code}' "$url" 2>/dev/null || echo "000"
}

market_data_body_indicates_cooldown() {
  local body_path="$1"
  [[ -f "$body_path" ]] || return 1
  grep -Eqi 'provider_cooldown|Schwab REST cooldown open|cooldown expires|brief cooldown' "$body_path"
}

humanize_market_data_issue() {
  local raw="${1:-}"
  case "$raw" in
    *"provider_cooldown"*|*"Schwab REST cooldown open"*)
      printf '%s' "Schwab market data is in a brief cooldown."
      ;;
    *"human_action_required"*|*"refresh token rejected"*|*"Re-authorize Schwab"*|*"authorize"*|*"token"*)
      printf '%s' "Schwab credentials need operator attention."
      ;;
    *"/market-data/ready"*|*"000"*)
      printf '%s' "The local market-data service is unreachable."
      ;;
    *)
      printf '%s' "$raw"
      ;;
  esac
}

market_data_advisory_should_recover() {
  local check_name="$1"
  local min_duration_seconds="${2:-900}"
  local check_status
  check_status=$(get_check_status "$check_name")
  if [[ "$check_status" != "failing" ]]; then
    return 1
  fi

  local first_failure last_alert last_recovery current_time
  first_failure=$(get_first_failure_time "$check_name")
  last_alert=$(get_last_alert_time "$check_name")
  last_recovery=$(get_check_last_recovery_time "$check_name")
  current_time=$(get_current_timestamp)

  if [[ "$last_alert" == "0" || "$first_failure" == "0" ]]; then
    return 1
  fi
  if [[ $((current_time - first_failure)) -lt "$min_duration_seconds" ]]; then
    return 1
  fi
  if [[ $((current_time - last_alert)) -lt "$min_duration_seconds" ]]; then
    return 1
  fi
  if [[ "$last_recovery" != "0" && $((current_time - last_recovery)) -lt "$min_duration_seconds" ]]; then
    return 1
  fi
  return 0
}

get_iso8601_age_seconds() {
  local iso_timestamp="${1:-}"
  python3 - "$iso_timestamp" <<'PY'
from __future__ import annotations

from datetime import UTC, datetime
import sys

value = (sys.argv[1] or "").strip()
if not value:
    print("")
    raise SystemExit(0)

try:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
except Exception:
    print("")
    raise SystemExit(0)

if parsed.tzinfo is None:
    parsed = parsed.replace(tzinfo=UTC)

now = datetime.now(UTC)
age = int((now - parsed.astimezone(UTC)).total_seconds())
if age < 0:
    age = 0
print(age)
PY
}

humanize_pre_open_canary_check() {
  local check_name="${1:-}"
  local result="${2:-}"
  local reason="${3:-}"
  local detail="${4:-}"
  case "$check_name" in
    service_ready)
      humanize_market_data_issue "${detail:-$reason}"
      ;;
    quote_smoke)
      if [[ -n "$detail" ]]; then
        humanize_market_data_issue "$detail"
      else
        printf '%s' "Quote smoke is unavailable."
      fi
      ;;
    regime_path)
      if [[ "$result" == "fail" ]]; then
        printf '%s' "Live market regime path failed."
      else
        printf '%s' "Live market regime path is degraded."
      fi
      ;;
    strategy_smoke)
      if [[ "$result" == "fail" ]]; then
        printf '%s' "Reduced CANSLIM strategy smoke failed."
      else
        printf '%s' "Reduced CANSLIM strategy smoke is degraded."
      fi
      ;;
    *)
      if [[ -n "$reason" ]]; then
        printf '%s' "$reason"
      else
        printf '%s' "$check_name"
      fi
      ;;
  esac
}

check_pre_open_readiness() {
  local readiness_check_name="pre_open_readiness"
  local warn_threshold_seconds="${PRE_OPEN_CANARY_WARN_THRESHOLD_SECONDS:-900}"

  if [[ ! -f "$PRE_OPEN_CANARY_PATH" ]]; then
    log "info" "Pre-open canary artifact not present at ${PRE_OPEN_CANARY_PATH}; skipping readiness check"
    clear_check_recovery_silent "$readiness_check_name"
    return
  fi

  local checked_at age_seconds
  checked_at=$(jq -r '.checked_at // empty' "$PRE_OPEN_CANARY_PATH" 2>/dev/null || true)
  age_seconds=$(get_iso8601_age_seconds "$checked_at")
  if [[ -z "$age_seconds" ]]; then
    log "warning" "Pre-open canary artifact is unreadable or missing checked_at; skipping readiness check"
    clear_check_recovery_silent "$readiness_check_name"
    return
  fi
  if [[ "$age_seconds" -gt "$PRE_OPEN_CANARY_MAX_AGE_SECONDS" ]]; then
    log "info" "Pre-open canary artifact is stale (${age_seconds}s old); skipping readiness check"
    clear_check_recovery_silent "$readiness_check_name"
    return
  fi

  local artifact_family result outcome_class
  artifact_family=$(jq -r '.artifact_family // empty' "$PRE_OPEN_CANARY_PATH" 2>/dev/null || true)
  result=$(jq -r '.result // empty' "$PRE_OPEN_CANARY_PATH" 2>/dev/null || true)
  outcome_class=$(jq -r '.outcome_class // empty' "$PRE_OPEN_CANARY_PATH" 2>/dev/null || true)
  if [[ "$artifact_family" != "readiness_check" || -z "$result" ]]; then
    log "warning" "Pre-open canary artifact at ${PRE_OPEN_CANARY_PATH} is missing required readiness fields"
    clear_check_recovery_silent "$readiness_check_name"
    return
  fi

  if [[ "$result" == "pass" ]]; then
    if [[ "$(get_last_alert_time "$readiness_check_name")" != "0" ]]; then
      recovery_alert "$readiness_check_name" "Pre-open canary recovered and the trading lane is ready for the open"
    else
      clear_check_recovery_silent "$readiness_check_name"
    fi
    log "info" "Pre-open canary: PASS (${age_seconds}s old)"
    return
  fi

  local non_pass_names
  non_pass_names=$(jq -r '[.checks[]? | select((.result // "pass") != "pass") | .name] | join(",")' "$PRE_OPEN_CANARY_PATH" 2>/dev/null || true)
  if [[ -z "$non_pass_names" ]]; then
    non_pass_names="unknown"
  fi

  if [[ "$non_pass_names" =~ ^(service_ready|quote_smoke)(,(service_ready|quote_smoke))*$ ]]; then
    local result_upper
    result_upper=$(printf '%s' "$result" | tr '[:lower:]' '[:upper:]')
    log "info" "Pre-open canary is ${result_upper}, but only for market-data-owned issues (${non_pass_names}); market-data watchdog owns alerting"
    clear_check_recovery_silent "$readiness_check_name"
    return
  fi

  local reasons_json
  reasons_json=$(jq -r '
    [
      .checks[]?
      | select((.result // "pass") != "pass")
      | {
          name: (.name // ""),
          result: (.result // ""),
          reason: (.evidence.reason // ""),
          detail: (.evidence.error // .evidence.degraded_reason // .evidence.operator_action // .evidence.detail // "")
        }
    ] | @json
  ' "$PRE_OPEN_CANARY_PATH" 2>/dev/null || echo "[]")

  local human_causes=""
  while IFS=$'\t' read -r check_name check_result check_reason check_detail; do
    [[ -n "$check_name" ]] || continue
    local rendered
    rendered=$(humanize_pre_open_canary_check "$check_name" "$check_result" "$check_reason" "$check_detail")
    if [[ -n "$rendered" ]]; then
      if [[ -n "$human_causes" ]]; then
        human_causes="${human_causes}; ${rendered}"
      else
        human_causes="${rendered}"
      fi
    fi
  done < <(echo "$reasons_json" | jq -r '.[] | [.name, .result, .reason, .detail] | @tsv' 2>/dev/null || true)

  if [[ -z "$human_causes" ]]; then
    human_causes="See readiness artifact for detailed evidence."
  fi

  if [[ "$result" == "fail" || "$outcome_class" == "readiness_fail" ]]; then
    alert "Pre-open canary failed. Trading lane is not ready for the open. ${human_causes}" "$readiness_check_name" "critical"
    return
  fi

  alert_if_failure_persists \
    "$readiness_check_name" \
    "$warn_threshold_seconds" \
    "Pre-open canary is degraded. Trading lane may not be fully ready for the open. ${human_causes}" \
    "warning" >/dev/null || true
}

# ── A) Cron Health ──
check_cron_quarantine() {
  local qdir="${HOME}/.openclaw/cron/quarantine"
  if [[ ! -d "$qdir" ]]; then
    log "info" "Cron quarantine check: none"
    return
  fi

  local found=0
  for qf in "$qdir"/*.quarantined; do
    [[ -f "$qf" ]] || continue
    found=1
    local name
    name=$(basename "$qf" .quarantined)
    local reason
    reason=$(tail -n 1 "$qf" 2>/dev/null || echo "unknown")
    alert "Cron \`${name}\` is quarantined (${reason})" "cron_quarantine_${name}" "critical"
  done

  if [[ "$found" -eq 0 ]]; then
    log "info" "Cron quarantine check: none"
  fi
}

check_cron_health() {
  local cron_dir="/Users/hd/.openclaw/cron"
  if [[ -d "$cron_dir" ]]; then
    for state_file in "$cron_dir"/*.state.json; do
      [[ -f "$state_file" ]] || continue
      local name=$(basename "$state_file" .state.json)
      local consecutive_failures=$(jq -r '.consecutiveFailures // 0' "$state_file" 2>/dev/null || echo 0)
      local check_name="cron_${name}"

      if [[ "$consecutive_failures" -ge 3 ]]; then
        alert "Cron \`${name}\` has ${consecutive_failures} consecutive failures" "$check_name" "warning"
      else
        # Send recovery alert if this cron was previously failing
        recovery_alert "$check_name" "Cron \`${name}\` recovered (${consecutive_failures} failures)"
      fi
    done
  fi
  log "info" "Cron health check complete"
}

# ── B) Heartbeat Health (variance + degradation) ──
check_heartbeat_health() {
  local check_name="heartbeat_health"
  local count
  count=$( (pgrep -f "openclaw.*heartbeat" 2>/dev/null || true) | wc -l | tr -d ' ' )
  local current_time
  current_time=$(get_current_timestamp)

  local pid=""
  local age_seconds=0
  local variance_seconds=0
  local restarts_6h=0
  local backend="process"

  if [[ "$count" -eq 1 ]]; then
    pid=$(pgrep -f "openclaw.*heartbeat" 2>/dev/null | head -n 1 | tr -d ' ')
    age_seconds=$(ps -o etimes= -p "$pid" 2>/dev/null | tr -d ' ')
    age_seconds="${age_seconds:-0}"

    local prev_pid
    prev_pid=$(get_heartbeat_monitor_value "last_pid")
    local prev_age
    prev_age=$(get_heartbeat_monitor_value "last_age")
    local prev_seen
    prev_seen=$(get_heartbeat_monitor_value "last_seen_at")

    if [[ -n "$prev_pid" && "$prev_pid" != "$pid" ]]; then
      track_heartbeat_restart "$current_time"
    fi

    if [[ -n "$prev_age" && -n "$prev_seen" && "$prev_pid" == "$pid" ]]; then
      local observed_delta=$((age_seconds - prev_age))
      local expected_delta=$((current_time - prev_seen))
      if [[ "$observed_delta" -lt 0 ]]; then
        observed_delta=0
      fi
      local drift=$((observed_delta - expected_delta))
      if [[ "$drift" -lt 0 ]]; then
        drift=$((drift * -1))
      fi
      variance_seconds="$drift"
    fi

    record_heartbeat_observation "$current_time" "$pid" "$age_seconds"
    restarts_6h=$(get_heartbeat_restarts_6h "$current_time")
  elif [[ "$count" -eq 0 ]]; then
    local state_age_seconds
    state_age_seconds=$(get_heartbeat_state_age_seconds "$current_time")
    if [[ -n "$state_age_seconds" ]]; then
      backend="state"
      age_seconds="$state_age_seconds"
      count=1
      pid="heartbeat-state"
      variance_seconds=0
      restarts_6h=0
      record_heartbeat_observation "$current_time" "$pid" "$age_seconds"
    fi
  fi

  local classification
  classification=$(classify_heartbeat_health "$count" "$age_seconds" "$restarts_6h" "$variance_seconds")
  local severity="${classification%%|*}"
  local reason="${classification#*|}"

  if [[ "$backend" == "state" ]]; then
    reason=${reason/heartbeat process/heartbeat state}
    reason=${reason/heartbeat stable/heartbeat state stable}
  fi

  if [[ "$severity" == "critical" ]]; then
    alert "Heartbeat degraded (critical): ${reason}" "$check_name" "critical"
  elif [[ "$severity" == "warning" ]]; then
    alert "Heartbeat degraded (warning): ${reason}" "$check_name" "warning"
  else
    recovery_alert "$check_name" "Heartbeat health recovered (stable)"
    log "info" "Heartbeat healthy via ${backend}: count=${count}, age=${age_seconds}s, restarts_6h=${restarts_6h}, variance=${variance_seconds}s"
  fi
}

# ── C) Gateway Health ──
check_gateway_health() {
  local check_name="openclaw_gateway"
  local uid
  uid=$(id -u)
  local target="gui/${uid}/${GATEWAY_LABEL}"

  if nc -z 127.0.0.1 "$GATEWAY_PORT" 2>/dev/null; then
    recovery_alert "$check_name" "OpenClaw gateway recovered and is listening on ${GATEWAY_PORT}"
    log "info" "OpenClaw gateway: OK (${GATEWAY_PORT})"
    return
  fi

  log "warning" "OpenClaw gateway appears down on port ${GATEWAY_PORT}; attempting launchctl kickstart"
  launchctl kickstart -k "$target" >/dev/null 2>&1 || true
  sleep 8

  if nc -z 127.0.0.1 "$GATEWAY_PORT" 2>/dev/null; then
    ALERTS="${ALERTS}⚠️ OpenClaw gateway was down and watchdog restarted it successfully\n"
    log "warning" "OpenClaw gateway restarted successfully by watchdog"
    update_check_state "$check_name" "recovered"
    return
  fi

  alert "OpenClaw gateway is DOWN and automatic restart failed (label=${GATEWAY_LABEL}, port=${GATEWAY_PORT})" "$check_name" "critical"
}

# ── D) Mission Control Health ──
check_mission_control_health() {
  local check_name="mission_control"
  local health_url="${MISSION_CONTROL_BASE_URL%/}${MISSION_CONTROL_HEALTH_PATH}"
  local body
  body="$(mktemp)"
  trap 'rm -f "${body:-}"' RETURN

  local code
  code=$(probe_json_endpoint "$health_url" "$body")
  if [[ "$code" == "200" ]]; then
    recovery_alert "$check_name" "Mission Control recovered and is responding on localhost:3000"
    log "info" "Mission Control: OK (${health_url})"
    return
  fi

  log "warning" "Mission Control unhealthy via ${health_url} (HTTP ${code}); attempting launchctl kickstart"
  if attempt_launchd_restart "$MISSION_CONTROL_LAUNCHD_LABEL" "$MISSION_CONTROL_RESTART_WAIT_SECONDS"; then
    code=$(probe_json_endpoint "$health_url" "$body")
  fi

  if [[ "$code" == "200" ]]; then
    ALERTS="${ALERTS}⚠️ Mission Control was down and watchdog restarted it successfully\n"
    log "warning" "Mission Control restarted successfully by watchdog"
    update_check_state "$check_name" "recovered"
    return
  fi

  alert "Mission Control is DOWN and automatic restart failed (${health_url}, HTTP ${code})" "$check_name" "critical"
}

# ── E) Market Data Health ──
check_market_data_health() {
  local readiness_check_name="market_data_service"
  local provider_check_name="market_data_provider"
  local quote_check_name="market_data_quotes"
  local advisory_threshold_seconds="${MARKET_DATA_ADVISORY_THRESHOLD_SECONDS:-900}"
  local ready_body ops_body quote_body
  ready_body="$(mktemp)"
  ops_body="$(mktemp)"
  quote_body="$(mktemp)"
  trap 'rm -f "${ready_body:-}" "${ops_body:-}" "${quote_body:-}"' RETURN

  local ready_url="${MARKET_DATA_BASE_URL}/market-data/ready"
  local ops_url="${MARKET_DATA_BASE_URL}/market-data/ops"
  local quote_url="${MARKET_DATA_BASE_URL}/market-data/quote/batch?symbols=${MARKET_DATA_QUOTE_SYMBOLS}"

  local ready_code
  ready_code=$(probe_json_endpoint "$ready_url" "$ready_body")
  if [[ "$ready_code" == "000" ]]; then
    log "warning" "Market-data service unreachable via ${ready_url}; attempting launchctl kickstart"
    if attempt_launchd_restart "$MARKET_DATA_LAUNCHD_LABEL" "$MARKET_DATA_RESTART_WAIT_SECONDS"; then
      ready_code=$(probe_json_endpoint "$ready_url" "$ready_body")
    fi
    if [[ "$ready_code" == "200" || "$ready_code" == "503" ]]; then
      ALERTS="${ALERTS}⚠️ Market-data service was unreachable and watchdog restarted it successfully\n"
      log "warning" "Market-data service restarted successfully by watchdog"
      update_check_state "$readiness_check_name" "recovered"
    else
      alert "Market-data service is unreachable and automatic restart failed (${ready_url})" "$readiness_check_name" "critical"
      return
    fi
  fi

  local operator_state operator_action
  operator_state=$(jq -r '.data.operatorState // empty' "$ready_body" 2>/dev/null || true)
  operator_action=$(jq -r '.data.operatorAction // empty' "$ready_body" 2>/dev/null || true)

  if [[ "$ready_code" == "503" || "$operator_state" == "human_action_required" || "$operator_state" == "max_connections_blocked" ]]; then
    local operator_issue
    operator_issue=$(humanize_market_data_issue "${operator_action:-${operator_state}}")
    local severity="warning"
    if [[ "$operator_state" == "human_action_required" ]]; then
      severity="critical"
    fi
    alert "Market-data service is not ready (${operator_state:-unknown}). ${operator_issue}" "$readiness_check_name" "$severity"
    return
  fi
  recovery_alert "$readiness_check_name" "Market-data service recovered and is ready"

  local ops_code
  ops_code=$(probe_json_endpoint "$ops_url" "$ops_body")
  if [[ "$ops_code" == "000" ]]; then
    alert "Market-data ops endpoint is unreachable (${ops_url})" "market_data_ops" "warning"
  elif [[ "$ops_code" != "200" ]]; then
    alert "Market-data ops endpoint returned HTTP ${ops_code}" "market_data_ops" "warning"
  else
    clear_check_recovery_silent "market_data_ops"
    local service_operator_state service_operator_action
    service_operator_state=$(jq -r '.data.serviceOperatorState // empty' "$ops_body" 2>/dev/null || true)
    service_operator_action=$(jq -r '.data.serviceOperatorAction // empty' "$ops_body" 2>/dev/null || true)
    if [[ "$service_operator_state" == "provider_cooldown" ]]; then
      alert_if_failure_persists "$provider_check_name" "$advisory_threshold_seconds" "Schwab market data is in a brief cooldown. Live trading data may be temporarily degraded." "warning" >/dev/null || true
      log "info" "Skipping quote-smoke restart while provider cooldown is active"
      return
    fi
    if [[ "$service_operator_state" == "human_action_required" ]]; then
      alert "Schwab credentials need operator attention. ${service_operator_action:-Re-authorize Schwab and refresh the cached token.}" "$provider_check_name" "critical"
      return
    fi
  fi

  local quote_code
  quote_code=$(probe_json_endpoint "$quote_url" "$quote_body")
  if [[ "$quote_code" == "503" ]] && market_data_body_indicates_cooldown "$quote_body"; then
    alert_if_failure_persists "$provider_check_name" "$advisory_threshold_seconds" "Schwab market data is in a brief cooldown. Live trading data may be temporarily degraded." "warning" >/dev/null || true
    clear_check_recovery_silent "$quote_check_name"
    log "info" "Skipping quote-smoke restart because quote response indicates provider cooldown"
    return
  fi
  if market_data_advisory_should_recover "$provider_check_name" "$advisory_threshold_seconds"; then
    recovery_alert "$provider_check_name" "Schwab market-data provider recovered and is accepting live requests"
  else
    clear_check_recovery_silent "$provider_check_name"
  fi
  if [[ "$quote_code" == "200" ]]; then
    if market_data_advisory_should_recover "$quote_check_name" "$advisory_threshold_seconds"; then
      recovery_alert "$quote_check_name" "Market-data quote smoke test recovered for ${MARKET_DATA_QUOTE_SYMBOLS}"
    else
      clear_check_recovery_silent "$quote_check_name"
    fi
    log "info" "Market-data quote smoke: OK (${MARKET_DATA_QUOTE_SYMBOLS})"
    return
  fi

  if [[ "$(get_check_status "$quote_check_name")" == "failing" ]]; then
    log "warning" "Market-data quote smoke still failing (HTTP ${quote_code}); attempting launchctl kickstart"
    if attempt_launchd_restart "$MARKET_DATA_LAUNCHD_LABEL" "$MARKET_DATA_RESTART_WAIT_SECONDS"; then
      quote_code=$(probe_json_endpoint "$quote_url" "$quote_body")
    fi
    if [[ "$quote_code" == "200" ]]; then
      ALERTS="${ALERTS}⚠️ Market-data quote smoke failed twice and watchdog restarted the service successfully\n"
      log "warning" "Market-data quote smoke recovered after watchdog restart"
      update_check_state "$quote_check_name" "recovered"
      return
    fi
    alert "Market-data quote smoke test still failing after automatic restart (HTTP ${quote_code} for ${MARKET_DATA_QUOTE_SYMBOLS})" "$quote_check_name" "warning"
    return
  fi

  mark_check_failing_silent "$quote_check_name"
  log "info" "Market-data quote smoke test failed once (HTTP ${quote_code} for ${MARKET_DATA_QUOTE_SYMBOLS}); waiting for a sustained failure before alerting"
}

# ── F) Tool Smoke Tests ──
check_tools() {
  log "info" "Fitness endpoint base: ${FITNESS_BASE_URL}"

  # gog
  local check_name="gog"
  gog_exit=0
  timeout 15 gog --account hameldesai3@gmail.com gmail search 'newer_than:1d' --max 1 --no-input 2>/dev/null || gog_exit=$?
  if [[ "$gog_exit" -eq 4 ]]; then
    alert "gog needs re-auth (exit code 4 = no auth)" "$check_name" "warning"
  elif [[ "$gog_exit" -eq 124 ]]; then
    alert "gog timed out (possible auth/network issue)" "$check_name" "warning"
  elif [[ "$gog_exit" -ne 0 ]]; then
    alert "gog smoke test failed (exit $gog_exit)" "$check_name" "warning"
  else
    recovery_alert "$check_name" "gog recovered and is working"
    log "info" "gog: OK"
  fi

  # Tonal - this is the main target for suppression
  local tonal_check_name="tonal"
  local tonal_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$FITNESS_BASE_URL/tonal/health" 2>/dev/null || echo "000")
  if [[ "$tonal_code" != "200" ]]; then
    log "warning" "Tonal health check failed (HTTP ${tonal_code}), waiting for in-service refresh self-heal"
    sleep 5
    tonal_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$FITNESS_BASE_URL/tonal/health" 2>/dev/null || echo "000")
    if [[ "$tonal_code" != "200" ]]; then
      alert "Tonal still down after in-service self-heal (HTTP ${tonal_code})" "$tonal_check_name" "warning"
    else
      recovery_alert "$tonal_check_name" "Tonal self-healed successfully"
      log "info" "Tonal self-healed successfully"
    fi
  else
    recovery_alert "$tonal_check_name" "Tonal recovered and is healthy"
    log "info" "Tonal: OK"
  fi

  # Whoop
  local whoop_check_name="whoop"
  local whoop_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$FITNESS_BASE_URL/whoop/data" 2>/dev/null || echo "000")
  if [[ "$whoop_code" != "200" ]]; then
    alert "Whoop health check failed (HTTP ${whoop_code})" "$whoop_check_name" "warning"
  else
    recovery_alert "$whoop_check_name" "Whoop recovered and is healthy"
    log "info" "Whoop: OK"
  fi

  # PostgreSQL
  local pg_check_name="postgresql"
  if ! psql cortana -c "SELECT 1;" &>/dev/null; then
    alert "PostgreSQL is DOWN" "$pg_check_name" "critical"
  else
    recovery_alert "$pg_check_name" "PostgreSQL recovered and is running"
    log "info" "PostgreSQL: OK"
  fi

}

check_degraded_agents() {
  local table_name
  table_name=$(psql cortana -tAc "SELECT CASE WHEN to_regclass('public.agents') IS NOT NULL THEN 'agents' WHEN to_regclass('public.agent') IS NOT NULL THEN 'agent' ELSE '' END;" 2>/dev/null | xargs)

  if [[ -z "$table_name" ]]; then
    log "info" "Degraded-agent check skipped (no agent table found)"
    return
  fi

  local degraded_json
  degraded_json=$(psql cortana -tAc "SELECT COALESCE(json_agg(row_to_json(t)),'[]'::json) FROM (SELECT id::text, name, status::text, EXTRACT(EPOCH FROM (NOW() - COALESCE(last_seen, NOW())))::int AS stale_seconds FROM ${table_name} WHERE status::text IN ('degraded','offline') OR (last_seen IS NOT NULL AND last_seen < NOW() - INTERVAL '45 minutes')) t;" 2>/dev/null || echo "[]")

  local active_keys=()
  while IFS= read -r row; do
    [[ -n "$row" ]] || continue
    local id name status stale
    id=$(echo "$row" | jq -r '.id')
    name=$(echo "$row" | jq -r '.name // .id')
    status=$(echo "$row" | jq -r '.status')
    stale=$(echo "$row" | jq -r '.stale_seconds')

    local severity="warning"
    if [[ "$status" == "offline" || "$stale" -gt 7200 ]]; then
      severity="critical"
    fi

    local check_name="agent_degraded_${id}"
    active_keys+=("$check_name")
    alert "Agent degraded: ${name} (status=${status}, stale=${stale}s)" "$check_name" "$severity"
  done < <(echo "$degraded_json" | jq -c '.[]' 2>/dev/null)

  # recover any previously failing degraded-agent checks no longer active
  local state
  state=$(load_state)
  while IFS= read -r key; do
    [[ -n "$key" ]] || continue
    local still_active="0"
    for a in "${active_keys[@]:-}"; do
      if [[ "$a" == "$key" ]]; then
        still_active="1"
        break
      fi
    done

    if [[ "$still_active" == "0" ]]; then
      local recovered_agent="${key#agent_degraded_}"
      recovery_alert "$key" "Agent recovered: ${recovered_agent}"
    fi
  done < <(echo "$state" | jq -r 'keys[] | select(startswith("agent_degraded_"))' 2>/dev/null)
}

# ── F) Budget Guard ──
check_budget() {
  local output
  output=$(npx tsx "$TELEGRAM_USAGE_HANDLER_PATH" json 2>/dev/null) || { log "warning" "Budget check failed to run"; return; }

  local day_of_month
  day_of_month=$(date +%d | sed 's/^0//')

  # Parse numeric quotaRemaining directly from JSON to avoid fragile text scraping
  local pct
  pct=$(echo "$output" | jq -r '.quotaRemaining // empty' 2>/dev/null || true)

  local budget_check_name="budget_low"

  if [[ -n "$pct" && "$pct" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    # pct = remaining quota (e.g., 100 = fully available, 0 = exhausted)
    local is_low
    is_low=$(echo "$pct" | awk '{print ($1 < 30) ? 1 : 0}')
    if [[ "$is_low" == "1" && "$day_of_month" -lt 20 ]]; then
      alert "API budget low: ~${pct}% quota remaining before day 20" "$budget_check_name" "warning"
    elif [[ "$is_low" == "1" ]]; then
      alert "API budget low: ~${pct}% quota remaining" "$budget_check_name" "warning"
    else
      recovery_alert "$budget_check_name" "API budget recovered: ${pct}% quota remaining"
      log "info" "Budget: ${pct}% quota remaining"
    fi
  else
    log "info" "Budget check: day ${day_of_month}, quota unknown (no reliable usage line)"
  fi
}

run_watchdog() {
  echo "=== Watchdog run: $(date) ==="

  check_cron_quarantine
  check_cron_health
  check_heartbeat_health
  check_gateway_health
  check_mission_control_health
  check_market_data_health
  check_pre_open_readiness
  check_tools
  check_degraded_agents
  check_budget

  if [[ -n "$ALERTS" ]]; then
    MSG="🐕 *Watchdog Alert*

${ALERTS}
_$(date '+%H:%M %b %d')_"
    send_alert_notifications "$(echo -e "$MSG")"
    log "info" "Alerts sent to notification channels"
  fi

  echo "=== Watchdog complete ==="
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  run_watchdog
fi
