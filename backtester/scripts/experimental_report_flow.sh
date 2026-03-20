#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKTESTER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

EXPERIMENTAL_SYMBOLS="${EXPERIMENTAL_SYMBOLS:-NVDA,BTC,COIN}"
JSON_OUTPUT="${JSON_OUTPUT:-0}"
PERSIST_SNAPSHOT="${PERSIST_SNAPSHOT:-1}"

ARGS=(--symbols "${EXPERIMENTAL_SYMBOLS}")

if [[ "${JSON_OUTPUT}" == "1" ]]; then
  ARGS+=(--json)
fi

echo "== Experimental research report =="
echo "Symbols: ${EXPERIMENTAL_SYMBOLS}"

(
  cd "${BACKTESTER_DIR}"
  uv run python experimental_alpha.py "${ARGS[@]}"
)

if [[ "${PERSIST_SNAPSHOT}" == "1" ]]; then
  echo
  echo "== Persisting experimental snapshot =="
  (
    cd "${BACKTESTER_DIR}"
    uv run python experimental_alpha.py --persist
  )
fi

