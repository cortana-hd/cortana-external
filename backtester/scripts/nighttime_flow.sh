#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKTESTER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${BACKTESTER_DIR}/.." && pwd)"
RUN_STAMP="${RUN_STAMP:-$(date -u +%Y%m%d-%H%M%S)}"
LOCAL_RUNS_ROOT="${LOCAL_RUNS_ROOT:-${BACKTESTER_DIR}/var/local-workflows}"
LOCAL_RUN_DIR="${LOCAL_RUNS_ROOT}/${RUN_STAMP}"
MANIFEST_STAGE_LOG="${LOCAL_RUN_DIR}/run-manifest-stages.tsv"
MANIFEST_ARTIFACT_LOG="${LOCAL_RUN_DIR}/run-manifest-artifacts.tsv"
MANIFEST_PATH="${LOCAL_RUN_DIR}/run-manifest.json"

NIGHTLY_LIMIT="${NIGHTLY_LIMIT:-20}"
SKIP_LIVE_PREFILTER_REFRESH="${SKIP_LIVE_PREFILTER_REFRESH:-0}"
FORCE_LIVE_PREFILTER_REFRESH="${FORCE_LIVE_PREFILTER_REFRESH:-0}"
REFRESH_SP500="${REFRESH_SP500:-0}"
JSON_OUTPUT="${JSON_OUTPUT:-0}"
MARKET_DATA_SERVICE_URL="${MARKET_DATA_SERVICE_URL:-http://localhost:3033}"
RUN_MARKET_DATA_OPS="${RUN_MARKET_DATA_OPS:-1}"
RUN_PREDICTION_ACCURACY="${RUN_PREDICTION_ACCURACY:-1}"
RUN_CRYPTO_DAILY_REFRESH="${RUN_CRYPTO_DAILY_REFRESH:-0}"
CRYPTO_REFRESH_SYMBOLS="${CRYPTO_REFRESH_SYMBOLS:-BTC,ETH}"
REQUIRE_MARKET_DATA_SERVICE="${REQUIRE_MARKET_DATA_SERVICE:-1}"
REQUIRE_SCHWAB_CONFIGURED="${REQUIRE_SCHWAB_CONFIGURED:-1}"
AUTO_COMMIT_PR="${AUTO_COMMIT_PR:-0}"
NIGHTLY_PROGRESS="${NIGHTLY_PROGRESS:-1}"
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
      --producer "backtester.nighttime_flow" \
      --run-id "${RUN_STAMP}" \
      --run-kind "nighttime_flow" \
      --started-at "${RUN_STARTED_AT}" \
      --finished-at "${finished_at}" \
      --final-status "$([[ ${rc} -eq 0 ]] && printf 'ok' || printf 'error')" \
      --stage-log "${MANIFEST_STAGE_LOG}" \
      --artifact-log "${MANIFEST_ARTIFACT_LOG}" \
      --setting "NIGHTLY_LIMIT=${NIGHTLY_LIMIT}" \
      --setting "SKIP_LIVE_PREFILTER_REFRESH=${SKIP_LIVE_PREFILTER_REFRESH}" \
      --setting "FORCE_LIVE_PREFILTER_REFRESH=${FORCE_LIVE_PREFILTER_REFRESH}" \
      --setting "REFRESH_SP500=${REFRESH_SP500}" \
      --setting "JSON_OUTPUT=${JSON_OUTPUT}" \
      --setting "RUN_MARKET_DATA_OPS=${RUN_MARKET_DATA_OPS}" \
      --setting "RUN_PREDICTION_ACCURACY=${RUN_PREDICTION_ACCURACY}" \
      --setting "RUN_CRYPTO_DAILY_REFRESH=${RUN_CRYPTO_DAILY_REFRESH}" \
      --setting "REQUIRE_MARKET_DATA_SERVICE=${REQUIRE_MARKET_DATA_SERVICE}"
  ) >/dev/null 2>&1 || true

  trap - EXIT
  exit ${rc}
}

trap finalize_run_manifest EXIT

run_nightly_discovery() {
  (
    cd "${BACKTESTER_DIR}"
    NIGHTLY_PROGRESS="${NIGHTLY_PROGRESS}" uv run python -u nightly_discovery.py "${ARGS[@]}"
  ) | tee "${LOCAL_RUN_DIR}/nightly-discovery.txt"
}

run_market_data_ops() {
  curl -fsS "${MARKET_DATA_SERVICE_URL}/market-data/ops" \
    | (cd "${BACKTESTER_DIR}" && uv run python "${BACKTESTER_DIR}/scripts/local_output_formatter.py" --mode market-data-ops) \
    | tee "${LOCAL_RUN_DIR}/market-data-ops.txt"
}

run_prediction_accuracy_report() {
  (
    cd "${BACKTESTER_DIR}"
    uv run python prediction_accuracy_report.py
  ) | tee "${LOCAL_RUN_DIR}/prediction-accuracy.txt"
}

run_trade_lifecycle_cycle() {
  (
    cd "${BACKTESTER_DIR}"
    uv run python trade_lifecycle_cycle.py --review-only --json
  ) >"${LOCAL_RUN_DIR}/trade-lifecycle-cycle.json"
}

run_trade_lifecycle_report() {
  (
    cd "${BACKTESTER_DIR}"
    uv run python trade_lifecycle_report.py
  ) | tee "${LOCAL_RUN_DIR}/trade-lifecycle.txt"
}

ARGS=(--limit "${NIGHTLY_LIMIT}")

if [[ "${SKIP_LIVE_PREFILTER_REFRESH}" == "1" ]]; then
  ARGS+=(--skip-live-prefilter-refresh)
fi

if [[ "${FORCE_LIVE_PREFILTER_REFRESH}" == "1" ]]; then
  ARGS+=(--force-live-prefilter-refresh)
fi

if [[ "${REFRESH_SP500}" == "1" ]]; then
  ARGS+=(--refresh-sp500)
fi

if [[ "${JSON_OUTPUT}" == "1" ]]; then
  ARGS+=(--json)
fi

echo "== Nighttime flow =="
echo "Running nightly discovery with limit=${NIGHTLY_LIMIT}"

if [[ "${REQUIRE_MARKET_DATA_SERVICE}" == "1" ]]; then
  echo
  echo "== Market data preflight =="
  run_stage "market_data_preflight" ensure_market_data_runtime_ready "${MARKET_DATA_SERVICE_URL}" "${REQUIRE_SCHWAB_CONFIGURED}"
else
  record_skipped_stage "market_data_preflight"
fi

if [[ "${RUN_CRYPTO_DAILY_REFRESH}" == "1" ]]; then
  echo
  echo "== Refreshing direct crypto cache (${CRYPTO_REFRESH_SYMBOLS}) =="
  CRYPTO_REFRESH_RAW="$(mktemp)"
  if run_stage "crypto_refresh" curl -fsS -X POST "${MARKET_DATA_SERVICE_URL}/market-data/crypto/refresh?symbols=${CRYPTO_REFRESH_SYMBOLS}" \
    >"${CRYPTO_REFRESH_RAW}" 2>/dev/null
  then
    cp "${CRYPTO_REFRESH_RAW}" "${LOCAL_RUN_DIR}/crypto-refresh-raw.json"
    record_manifest_artifact "crypto-refresh-raw" "file" "${LOCAL_RUN_DIR}/crypto-refresh-raw.json"
    python3 - "${CRYPTO_REFRESH_RAW}" <<'PY'
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
  rm -f "${CRYPTO_REFRESH_RAW}"
else
  record_skipped_stage "crypto_refresh"
fi

run_stage "nightly_discovery" run_nightly_discovery
record_manifest_artifact "nightly-discovery-view" "file" "${LOCAL_RUN_DIR}/nightly-discovery.txt"

if [[ "${RUN_MARKET_DATA_OPS}" == "1" ]]; then
  echo
  echo "== Market data ops =="
  if ! run_stage "market_data_ops" run_market_data_ops; then
    printf '%s\n' "Market data ops" "" "- Unable to reach ${MARKET_DATA_SERVICE_URL}/market-data/ops"
  fi
  record_manifest_artifact "market-data-ops-view" "file" "${LOCAL_RUN_DIR}/market-data-ops.txt"
else
  record_skipped_stage "market_data_ops"
fi

if [[ "${RUN_PREDICTION_ACCURACY}" == "1" ]]; then
  echo
  echo "== Prediction accuracy =="
  run_stage "prediction_accuracy" run_prediction_accuracy_report
  record_manifest_artifact "prediction-accuracy-view" "file" "${LOCAL_RUN_DIR}/prediction-accuracy.txt"
else
  record_skipped_stage "prediction_accuracy"
fi

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

if [[ "${AUTO_COMMIT_PR}" == "1" ]]; then
  source "${SCRIPT_DIR}/auto_commit_pr.sh"
  auto_commit_pr "nighttime" "${RUN_STAMP}" "${REPO_ROOT}"
fi
