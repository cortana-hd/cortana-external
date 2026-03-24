#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKTESTER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${BACKTESTER_DIR}/.." && pwd)"
RUN_STAMP="${RUN_STAMP:-$(date -u +%Y%m%d-%H%M%S)}"

NIGHTLY_LIMIT="${NIGHTLY_LIMIT:-20}"
SKIP_LIVE_PREFILTER_REFRESH="${SKIP_LIVE_PREFILTER_REFRESH:-0}"
FORCE_LIVE_PREFILTER_REFRESH="${FORCE_LIVE_PREFILTER_REFRESH:-0}"
REFRESH_SP500="${REFRESH_SP500:-0}"
JSON_OUTPUT="${JSON_OUTPUT:-0}"
MARKET_DATA_SERVICE_URL="${MARKET_DATA_SERVICE_URL:-http://localhost:3033}"
RUN_MARKET_DATA_OPS="${RUN_MARKET_DATA_OPS:-1}"
RUN_PREDICTION_ACCURACY="${RUN_PREDICTION_ACCURACY:-1}"
RUN_PAPER_TRADE_CYCLE="${RUN_PAPER_TRADE_CYCLE:-1}"
RUN_CRYPTO_DAILY_REFRESH="${RUN_CRYPTO_DAILY_REFRESH:-0}"
CRYPTO_REFRESH_SYMBOLS="${CRYPTO_REFRESH_SYMBOLS:-BTC,ETH}"
REQUIRE_MARKET_DATA_SERVICE="${REQUIRE_MARKET_DATA_SERVICE:-1}"
REQUIRE_SCHWAB_CONFIGURED="${REQUIRE_SCHWAB_CONFIGURED:-1}"
AUTO_COMMIT_PR="${AUTO_COMMIT_PR:-0}"
NIGHTLY_PROGRESS="${NIGHTLY_PROGRESS:-1}"

source "${SCRIPT_DIR}/market_data_preflight.sh"

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
  ensure_market_data_runtime_ready "${MARKET_DATA_SERVICE_URL}" "${REQUIRE_SCHWAB_CONFIGURED}"
fi

if [[ "${RUN_CRYPTO_DAILY_REFRESH}" == "1" ]]; then
  echo
  echo "== Refreshing direct crypto cache (${CRYPTO_REFRESH_SYMBOLS}) =="
  CRYPTO_REFRESH_RAW="$(mktemp)"
  if curl -fsS -X POST "${MARKET_DATA_SERVICE_URL}/market-data/crypto/refresh?symbols=${CRYPTO_REFRESH_SYMBOLS}" \
    >"${CRYPTO_REFRESH_RAW}" 2>/dev/null
  then
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
fi

(
  cd "${BACKTESTER_DIR}"
  NIGHTLY_PROGRESS="${NIGHTLY_PROGRESS}" uv run python -u nightly_discovery.py "${ARGS[@]}"
)

if [[ "${RUN_MARKET_DATA_OPS}" == "1" ]]; then
  echo
  echo "== Market data ops =="
  if ! curl -fsS "${MARKET_DATA_SERVICE_URL}/market-data/ops" \
    | (cd "${BACKTESTER_DIR}" && uv run python "${BACKTESTER_DIR}/scripts/local_output_formatter.py" --mode market-data-ops); then
    printf '%s\n' "Market data ops" "" "- Unable to reach ${MARKET_DATA_SERVICE_URL}/market-data/ops"
  fi
fi

if [[ "${RUN_PREDICTION_ACCURACY}" == "1" ]]; then
  echo
  echo "== Prediction accuracy =="
  (
    cd "${BACKTESTER_DIR}"
    uv run python prediction_accuracy_report.py
  )
fi

if [[ "${RUN_PAPER_TRADE_CYCLE}" == "1" ]]; then
  echo
  echo "== Paper trade review =="
  (
    cd "${BACKTESTER_DIR}"
    uv run python paper_trade_cycle.py --mode nighttime
  )
fi

if [[ "${AUTO_COMMIT_PR}" == "1" ]]; then
  source "${SCRIPT_DIR}/auto_commit_pr.sh"
  auto_commit_pr "nighttime" "${RUN_STAMP}" "${REPO_ROOT}"
fi
