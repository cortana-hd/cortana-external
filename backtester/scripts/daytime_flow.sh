#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKTESTER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${BACKTESTER_DIR}/.." && pwd)"

CANSLIM_LIMIT="${CANSLIM_LIMIT:-8}"
CANSLIM_MIN_SCORE="${CANSLIM_MIN_SCORE:-6}"
DIPBUYER_LIMIT="${DIPBUYER_LIMIT:-8}"
DIPBUYER_MIN_SCORE="${DIPBUYER_MIN_SCORE:-6}"
DEEP_DIVE_SYMBOL="${DEEP_DIVE_SYMBOL:-NVDA}"
QUICK_CHECK_SYMBOL="${QUICK_CHECK_SYMBOL:-BTC}"
RUN_MARKET_INTEL="${RUN_MARKET_INTEL:-1}"
MARKET_INTEL_CMD="${MARKET_INTEL_CMD:-./tools/market-intel/run_market_intel.sh}"
RUN_DYNAMIC_WATCHLIST_REFRESH="${RUN_DYNAMIC_WATCHLIST_REFRESH:-1}"
DYNAMIC_WATCHLIST_CMD="${DYNAMIC_WATCHLIST_CMD:-./tools/stock-discovery/trend_sweep.sh}"
RUN_DEEP_DIVE="${RUN_DEEP_DIVE:-0}"
REVIEW_DETAIL_LIMIT="${REVIEW_DETAIL_LIMIT:-50}"
LOCAL_OUTPUT_FORMATTER="${LOCAL_OUTPUT_FORMATTER:-${BACKTESTER_DIR}/scripts/local_output_formatter.py}"
LOCAL_RUNS_ROOT="${LOCAL_RUNS_ROOT:-${BACKTESTER_DIR}/var/local-workflows}"
RUN_STAMP="${RUN_STAMP:-$(date -u +%Y%m%d-%H%M%S)}"
LOCAL_RUN_DIR="${LOCAL_RUNS_ROOT}/${RUN_STAMP}"
MANIFEST_STAGE_LOG="${LOCAL_RUN_DIR}/run-manifest-stages.tsv"
MANIFEST_ARTIFACT_LOG="${LOCAL_RUN_DIR}/run-manifest-artifacts.tsv"
MANIFEST_PATH="${LOCAL_RUN_DIR}/run-manifest.json"
LEADER_BASKET_PATH="${LEADER_BASKET_PATH:-${BACKTESTER_DIR}/.cache/leader_baskets/leader-baskets-latest.json}"
MARKET_DATA_SERVICE_URL="${MARKET_DATA_SERVICE_URL:-http://localhost:3033}"
RUN_MARKET_DATA_OPS="${RUN_MARKET_DATA_OPS:-1}"
RUN_CRYPTO_DAILY_REFRESH="${RUN_CRYPTO_DAILY_REFRESH:-0}"
CRYPTO_REFRESH_SYMBOLS="${CRYPTO_REFRESH_SYMBOLS:-BTC,ETH}"
REQUIRE_MARKET_DATA_SERVICE="${REQUIRE_MARKET_DATA_SERVICE:-1}"
REQUIRE_SCHWAB_CONFIGURED="${REQUIRE_SCHWAB_CONFIGURED:-1}"
AUTO_COMMIT_PR="${AUTO_COMMIT_PR:-0}"
RUN_TRADE_LIFECYCLE="${RUN_TRADE_LIFECYCLE:-1}"

mkdir -p "${LOCAL_RUN_DIR}"
RUN_STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
CURRENT_STAGE_NAME=""
CURRENT_STAGE_STARTED_AT=""
CURRENT_STAGE_RECORDED="1"
>"${MANIFEST_STAGE_LOG}"
>"${MANIFEST_ARTIFACT_LOG}"

source "${SCRIPT_DIR}/market_data_preflight.sh"

iso_utc() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

record_manifest_stage() {
  local name="$1"
  local status="$2"
  local started_at="$3"
  local finished_at="$4"
  printf '%s\t%s\t%s\t%s\n' "${name}" "${status}" "${started_at}" "${finished_at}" >>"${MANIFEST_STAGE_LOG}"
}

record_manifest_artifact() {
  local label="$1"
  local family="$2"
  local path="$3"
  printf '%s\t%s\t%s\n' "${label}" "${family}" "${path}" >>"${MANIFEST_ARTIFACT_LOG}"
}

record_skipped_stage() {
  local name="$1"
  local now
  now="$(iso_utc)"
  record_manifest_stage "${name}" "skipped" "${now}" "${now}"
}

run_stage() {
  local name="$1"
  shift

  local started_at
  started_at="$(iso_utc)"
  CURRENT_STAGE_NAME="${name}"
  CURRENT_STAGE_STARTED_AT="${started_at}"
  CURRENT_STAGE_RECORDED="0"

  set +e
  "$@"
  local rc=$?
  set -e

  local finished_at
  finished_at="$(iso_utc)"
  if [[ ${rc} -eq 0 ]]; then
    record_manifest_stage "${name}" "ok" "${started_at}" "${finished_at}"
  else
    record_manifest_stage "${name}" "error" "${started_at}" "${finished_at}"
  fi
  CURRENT_STAGE_NAME=""
  CURRENT_STAGE_STARTED_AT=""
  CURRENT_STAGE_RECORDED="1"
  return ${rc}
}

finalize_run_manifest() {
  local rc=$?
  local finished_at
  finished_at="$(iso_utc)"

  if [[ -n "${CURRENT_STAGE_NAME}" && "${CURRENT_STAGE_RECORDED}" != "1" ]]; then
    record_manifest_stage "${CURRENT_STAGE_NAME}" "error" "${CURRENT_STAGE_STARTED_AT}" "${finished_at}"
  fi

  (
    cd "${BACKTESTER_DIR}"
    python3 -m evaluation.run_manifest build \
      --manifest-path "${MANIFEST_PATH}" \
      --producer "backtester.daytime_flow" \
      --run-id "${RUN_STAMP}" \
      --run-kind "daytime_flow" \
      --started-at "${RUN_STARTED_AT}" \
      --finished-at "${finished_at}" \
      --final-status "$([[ ${rc} -eq 0 ]] && printf 'ok' || printf 'error')" \
      --stage-log "${MANIFEST_STAGE_LOG}" \
      --artifact-log "${MANIFEST_ARTIFACT_LOG}" \
      --setting "CANSLIM_LIMIT=${CANSLIM_LIMIT}" \
      --setting "CANSLIM_MIN_SCORE=${CANSLIM_MIN_SCORE}" \
      --setting "DIPBUYER_LIMIT=${DIPBUYER_LIMIT}" \
      --setting "DIPBUYER_MIN_SCORE=${DIPBUYER_MIN_SCORE}" \
      --setting "RUN_MARKET_INTEL=${RUN_MARKET_INTEL}" \
      --setting "RUN_DYNAMIC_WATCHLIST_REFRESH=${RUN_DYNAMIC_WATCHLIST_REFRESH}" \
      --setting "RUN_MARKET_DATA_OPS=${RUN_MARKET_DATA_OPS}" \
      --setting "RUN_DEEP_DIVE=${RUN_DEEP_DIVE}" \
      --setting "RUN_CRYPTO_DAILY_REFRESH=${RUN_CRYPTO_DAILY_REFRESH}" \
      --setting "REQUIRE_MARKET_DATA_SERVICE=${REQUIRE_MARKET_DATA_SERVICE}" \
      --setting "QUICK_CHECK_SYMBOL=${QUICK_CHECK_SYMBOL}"
  ) >/dev/null 2>&1 || true

  trap - EXIT
  exit ${rc}
}

trap finalize_run_manifest EXIT

refresh_market_context() {
  (
    cd "${REPO_ROOT}"
    "${MARKET_INTEL_CMD}"
  )
}

refresh_dynamic_watchlist() {
  (
    cd "${REPO_ROOT}"
    "${DYNAMIC_WATCHLIST_CMD}"
  )
}

run_market_regime() {
  (
    cd "${BACKTESTER_DIR}"
    uv run python advisor.py --market | tee "${LOCAL_RUN_DIR}/market-regime.txt"
  )
}

run_deep_dive() {
  (
    cd "${BACKTESTER_DIR}"
    uv run python advisor.py --symbol "${DEEP_DIVE_SYMBOL}"
  )
}

run_quick_check() {
  (
    cd "${BACKTESTER_DIR}"
    PYTHONWARNINGS=ignore uv run python advisor.py --quick-check "${QUICK_CHECK_SYMBOL}" \
      >"${LOCAL_RUN_DIR}/quick-check-raw.txt" 2>&1
  )
}

run_trade_lifecycle_cycle() {
  (
    cd "${BACKTESTER_DIR}"
    uv run python trade_lifecycle_cycle.py \
      --alert-json "${LOCAL_RUN_DIR}/canslim-alert.json" \
      --alert-json "${LOCAL_RUN_DIR}/dipbuyer-alert.json" \
      --json
  ) >"${LOCAL_RUN_DIR}/trade-lifecycle-cycle.json"
}

run_trade_lifecycle_report() {
  (
    cd "${BACKTESTER_DIR}"
    uv run python trade_lifecycle_report.py
  ) | tee "${LOCAL_RUN_DIR}/trade-lifecycle.txt"
}

run_formatted_section() {
  local label="$1"
  local slug="$2"
  local mode="$3"
  shift 3

  local raw_path="${LOCAL_RUN_DIR}/${slug}-raw.txt"
  local view_path="${LOCAL_RUN_DIR}/${slug}.txt"
  local json_path="${LOCAL_RUN_DIR}/${slug}.json"

  echo
  echo "== ${label} =="
  (
    cd "${BACKTESTER_DIR}"
    if [[ "${mode}" == "alert" ]]; then
      "$@" --output-json "${json_path}" >"${raw_path}" 2>&1
    else
      "$@" >"${raw_path}" 2>&1
    fi
  )
  if [[ "${mode}" == "alert" && -f "${LEADER_BASKET_PATH}" ]]; then
    uv run python "${LOCAL_OUTPUT_FORMATTER}" --mode "${mode}" --leader-basket-path "${LEADER_BASKET_PATH}" <"${raw_path}" >"${view_path}"
  else
    uv run python "${LOCAL_OUTPUT_FORMATTER}" --mode "${mode}" <"${raw_path}" >"${view_path}"
  fi
  cat "${view_path}"
  record_manifest_artifact "${slug}-raw" "file" "${raw_path}"
  record_manifest_artifact "${slug}-view" "file" "${view_path}"
  if [[ "${mode}" == "alert" ]]; then
    record_manifest_artifact "${slug}-json" "strategy_alert" "${json_path}"
  fi
}

echo "== Daytime flow =="

if [[ "${REQUIRE_MARKET_DATA_SERVICE}" == "1" ]]; then
  echo
  echo "== Market data preflight =="
  run_stage "market_data_preflight" ensure_market_data_runtime_ready "${MARKET_DATA_SERVICE_URL}" "${REQUIRE_SCHWAB_CONFIGURED}"
else
  record_skipped_stage "market_data_preflight"
fi

if [[ "${RUN_MARKET_INTEL}" == "1" ]]; then
  echo
  echo "== Refreshing market context (SPY regime + Polymarket) =="
  run_stage "market_context_refresh" refresh_market_context
else
  echo
  echo "== Skipping market context refresh (RUN_MARKET_INTEL=0) =="
  record_skipped_stage "market_context_refresh"
fi

if [[ "${RUN_DYNAMIC_WATCHLIST_REFRESH}" == "1" ]]; then
  echo
  echo "== Refreshing X/Twitter watchlist =="
  run_stage "dynamic_watchlist_refresh" refresh_dynamic_watchlist
else
  echo
  echo "== Skipping X/Twitter watchlist refresh (RUN_DYNAMIC_WATCHLIST_REFRESH=0) =="
  record_skipped_stage "dynamic_watchlist_refresh"
fi

if [[ "${RUN_CRYPTO_DAILY_REFRESH}" == "1" ]]; then
  echo
  echo "== Refreshing direct crypto cache (${CRYPTO_REFRESH_SYMBOLS}) =="
  if run_stage "crypto_refresh" curl -fsS -X POST "${MARKET_DATA_SERVICE_URL}/market-data/crypto/refresh?symbols=${CRYPTO_REFRESH_SYMBOLS}" \
    >"${LOCAL_RUN_DIR}/crypto-refresh-raw.json" 2>/dev/null; then
    record_manifest_artifact "crypto-refresh-raw" "file" "${LOCAL_RUN_DIR}/crypto-refresh-raw.json"
    python3 - "${LOCAL_RUN_DIR}/crypto-refresh-raw.json" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    payload = json.load(handle)

rows = ((payload.get("data") or {}).get("refreshed") or [])
print("Crypto refresh\n")
for row in rows:
    print(
        f"- {row.get('symbol')}: {row.get('status')} | "
        f"rows {row.get('rowCount')} | refreshedAt {row.get('refreshedAt')}"
    )
PY
  else
    printf '%s\n' "Crypto refresh" "" "- Unable to refresh ${CRYPTO_REFRESH_SYMBOLS} via ${MARKET_DATA_SERVICE_URL}/market-data/crypto/refresh"
  fi
else
  record_skipped_stage "crypto_refresh"
fi

echo
if [[ "${RUN_MARKET_DATA_OPS}" == "1" ]]; then
  echo "== Market data ops =="
  if run_stage "market_data_ops" curl -fsS "${MARKET_DATA_SERVICE_URL}/market-data/ops" \
    >"${LOCAL_RUN_DIR}/market-data-ops-raw.json" 2>/dev/null; then
    uv run python "${LOCAL_OUTPUT_FORMATTER}" --mode market-data-ops \
      <"${LOCAL_RUN_DIR}/market-data-ops-raw.json" \
      >"${LOCAL_RUN_DIR}/market-data-ops.txt"
    cat "${LOCAL_RUN_DIR}/market-data-ops.txt"
    record_manifest_artifact "market-data-ops-raw" "file" "${LOCAL_RUN_DIR}/market-data-ops-raw.json"
    record_manifest_artifact "market-data-ops-view" "file" "${LOCAL_RUN_DIR}/market-data-ops.txt"
  else
    printf '%s\n' "Market data ops" "" "- Unable to reach ${MARKET_DATA_SERVICE_URL}/market-data/ops" \
      | tee "${LOCAL_RUN_DIR}/market-data-ops.txt"
    record_manifest_artifact "market-data-ops-view" "file" "${LOCAL_RUN_DIR}/market-data-ops.txt"
  fi
  echo
else
  record_skipped_stage "market_data_ops"
fi

echo
echo "== Checking market regime =="
run_stage "market_regime" run_market_regime
record_manifest_artifact "market-regime-view" "file" "${LOCAL_RUN_DIR}/market-regime.txt"

echo
echo "== Leader buckets =="
if [[ -f "${LEADER_BASKET_PATH}" ]]; then
  cp "${LEADER_BASKET_PATH}" "${LOCAL_RUN_DIR}/leader-baskets-raw.json"
  uv run python "${LOCAL_OUTPUT_FORMATTER}" --mode leader-baskets \
    <"${LEADER_BASKET_PATH}" \
    >"${LOCAL_RUN_DIR}/leader-baskets.txt"
  cat "${LOCAL_RUN_DIR}/leader-baskets.txt"
  record_manifest_stage "leader_buckets" "ok" "$(iso_utc)" "$(iso_utc)"
  record_manifest_artifact "leader-baskets-raw" "file" "${LOCAL_RUN_DIR}/leader-baskets-raw.json"
  record_manifest_artifact "leader-baskets-view" "file" "${LOCAL_RUN_DIR}/leader-baskets.txt"
else
  printf '%s\n' "Leader buckets" "" "- Leader basket artifact is missing. Run ./scripts/nighttime_flow.sh first." \
    | tee "${LOCAL_RUN_DIR}/leader-baskets.txt"
  record_manifest_stage "leader_buckets" "warning" "$(iso_utc)" "$(iso_utc)"
  record_manifest_artifact "leader-baskets-view" "file" "${LOCAL_RUN_DIR}/leader-baskets.txt"
fi

run_stage "canslim_alert" run_formatted_section \
  "Running CANSLIM alert" \
  "canslim-alert" \
  "alert" \
  uv run python canslim_alert.py \
    --limit "${CANSLIM_LIMIT}" \
    --min-score "${CANSLIM_MIN_SCORE}" \
    --review-detail-limit "${REVIEW_DETAIL_LIMIT}"

run_stage "dipbuyer_alert" run_formatted_section \
  "Running Dip Buyer alert" \
  "dipbuyer-alert" \
  "alert" \
  uv run python dipbuyer_alert.py \
    --limit "${DIPBUYER_LIMIT}" \
    --min-score "${DIPBUYER_MIN_SCORE}" \
    --review-detail-limit "${REVIEW_DETAIL_LIMIT}"

if [[ "${RUN_TRADE_LIFECYCLE}" == "1" ]]; then
  echo
  echo "== Trade lifecycle =="
  run_stage "trade_lifecycle_cycle" run_trade_lifecycle_cycle
  record_manifest_artifact "trade-lifecycle-cycle" "file" "${LOCAL_RUN_DIR}/trade-lifecycle-cycle.json"
  run_stage "trade_lifecycle_report" run_trade_lifecycle_report
  record_manifest_artifact "trade-lifecycle-view" "file" "${LOCAL_RUN_DIR}/trade-lifecycle.txt"
else
  record_skipped_stage "trade_lifecycle_cycle"
  record_skipped_stage "trade_lifecycle_report"
fi

if [[ "${RUN_DEEP_DIVE}" == "1" ]]; then
  echo
  echo "== Deep dive: ${DEEP_DIVE_SYMBOL} =="
  run_stage "deep_dive" run_deep_dive
else
  record_skipped_stage "deep_dive"
fi

echo
echo "== Quick check: ${QUICK_CHECK_SYMBOL} =="
run_stage "quick_check" run_quick_check
uv run python "${LOCAL_OUTPUT_FORMATTER}" --mode quick-check \
  <"${LOCAL_RUN_DIR}/quick-check-raw.txt" \
  >"${LOCAL_RUN_DIR}/quick-check.txt"
cat "${LOCAL_RUN_DIR}/quick-check.txt"
record_manifest_artifact "quick-check-raw" "file" "${LOCAL_RUN_DIR}/quick-check-raw.txt"
record_manifest_artifact "quick-check-view" "file" "${LOCAL_RUN_DIR}/quick-check.txt"

echo
echo "Saved local run outputs: ${LOCAL_RUN_DIR}"

if [[ "${AUTO_COMMIT_PR}" == "1" ]]; then
  source "${SCRIPT_DIR}/auto_commit_pr.sh"
  auto_commit_pr "daytime" "${RUN_STAMP}" "${REPO_ROOT}"
fi
