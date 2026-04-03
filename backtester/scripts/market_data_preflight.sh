#!/usr/bin/env bash

ensure_market_data_runtime_ready() {
  local service_url="$1"
  local require_schwab="${2:-1}"
  local self_heal="${MARKET_DATA_SELF_HEAL:-1}"
  local launchd_label="${MARKET_DATA_LAUNCHD_LABEL:-com.cortana.fitness-service}"
  local ready_path
  local ops_path

  ready_path="$(mktemp)"
  ops_path="$(mktemp)"
  trap "rm -f '${ready_path}' '${ops_path}'" RETURN

  attempt_market_data_restart() {
    if [[ "${self_heal}" != "1" ]]; then
      return 1
    fi
    local target="gui/$(id -u)/${launchd_label}"
    if ! launchctl kickstart -k "${target}" >/dev/null 2>&1; then
      return 1
    fi
    sleep "${MARKET_DATA_SELF_HEAL_WAIT_SECONDS:-6}"
    return 0
  }

  if ! curl -fsS "${service_url}/market-data/ready" >"${ready_path}" 2>/dev/null; then
    if attempt_market_data_restart && curl -fsS "${service_url}/market-data/ready" >"${ready_path}" 2>/dev/null; then
      echo "- Auto-restarted ${launchd_label} after ${service_url}/market-data/ready was unreachable."
    else
    echo "Market data preflight"
    echo
    echo "- Unable to reach ${service_url}/market-data/ready"
    echo "- Start apps/external-service and try again."
    return 1
    fi
  fi

  if ! curl -fsS "${service_url}/market-data/ops" >"${ops_path}" 2>/dev/null; then
    if attempt_market_data_restart && curl -fsS "${service_url}/market-data/ops" >"${ops_path}" 2>/dev/null; then
      echo "- Auto-restarted ${launchd_label} after ${service_url}/market-data/ops was unreachable."
    else
    echo "Market data preflight"
    echo
    echo "- Unable to reach ${service_url}/market-data/ops"
    echo "- Start apps/external-service and try again."
    return 1
    fi
  fi

  local preflight_status
  local status_code
  set +e
  preflight_status="$(READY_PATH="${ready_path}" OPS_PATH="${ops_path}" REQUIRE_SCHWAB="${require_schwab}" python3 - <<'PY'
import json
import os
import sys

with open(os.environ["READY_PATH"], "r", encoding="utf-8") as handle:
    ready = json.load(handle)
with open(os.environ["OPS_PATH"], "r", encoding="utf-8") as handle:
    ops = json.load(handle)

ready_data = ready.get("data") or {}
ops_data = ops.get("data") or {}
health = (ops_data.get("health") or {}).get("providers") or {}
provider_metrics = health.get("providerMetrics") or {}

ready_flag = bool(ready_data.get("ready"))
operator_state = str(ready_data.get("operatorState") or ops_data.get("serviceOperatorState") or "unknown")
operator_action = str(ready_data.get("operatorAction") or ops_data.get("serviceOperatorAction") or "")
schwab_state = str(health.get("schwab") or "unknown")
token_status = str(health.get("schwabTokenStatus") or provider_metrics.get("schwabTokenStatus") or "unknown")
token_reason = str(health.get("schwabTokenReason") or provider_metrics.get("schwabTokenReason") or "")
require_schwab = os.environ.get("REQUIRE_SCHWAB", "1") == "1"

if not ready_flag:
    print("NOT_READY")
    print(operator_state)
    print(operator_action or token_reason)
    sys.exit(2)

if require_schwab and schwab_state != "configured":
    print("SCHWAB_DISABLED")
    print(schwab_state)
    print("Configure Schwab credentials for apps/external-service before running the local wrappers.")
    sys.exit(3)

if require_schwab and token_status == "human_action_required":
    print("TOKEN_ACTION_REQUIRED")
    print(token_status)
    print(token_reason or operator_action or "Re-authorize Schwab and refresh the cached token.")
    sys.exit(4)
PY
)"
  status_code=$?
  set -e

  case "${status_code}" in
    0)
      return 0
      ;;
    2)
      echo "Market data preflight"
      echo
      echo "- Service is not ready: $(printf '%s' "${preflight_status}" | sed -n '2p')"
      echo "- Action: $(printf '%s' "${preflight_status}" | sed -n '3p')"
      return 1
      ;;
    3)
      echo "Market data preflight"
      echo
      echo "- Schwab provider is not configured for the local TS service."
      echo "- Action: $(printf '%s' "${preflight_status}" | sed -n '3p')"
      echo "- Override with REQUIRE_SCHWAB_CONFIGURED=0 if you intentionally want cache-only behavior."
      return 1
      ;;
    4)
      echo "Market data preflight"
      echo
      echo "- Schwab credentials need operator action before these wrappers can run."
      echo "- Action: $(printf '%s' "${preflight_status}" | sed -n '3p')"
      return 1
      ;;
    *)
      echo "Market data preflight"
      echo
      echo "- Unable to parse market-data readiness state."
      return 1
      ;;
  esac
}
