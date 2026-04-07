#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
EXTERNAL_REPO="$(cd "${APP_DIR}/../.." && pwd)"
DEV_ROOT="$(cd "${EXTERNAL_REPO}/.." && pwd)"
CORTANA_REPO="${CORTANA_SOURCE_REPO:-${DEV_ROOT}/cortana}"
TELEGRAM_GUARD="${TRADING_OPS_GUARD_BIN:-${CORTANA_REPO}/tools/notifications/telegram-delivery-guard.sh}"

CONTEXT="${1:-manual}"

log() {
  printf '[trading-ops-smoke-guard] %s\n' "$*"
}

send_alert() {
  local body="$1"
  if [[ ! -x "${TELEGRAM_GUARD}" ]]; then
    log "telegram guard missing at ${TELEGRAM_GUARD}; cannot send alert"
    return 0
  fi

  "${TELEGRAM_GUARD}" \
    "$body" \
    "8171372724" \
    "" \
    "trading_ops_guardrail" \
    "mission_control:trading_ops_smoke_failed" \
    "critical" \
    "monitor" \
    "Trading Ops" \
    "now" \
    "mission-control-smoke-guard" >/dev/null 2>&1 || true
}

log "Running Trading Ops smoke check (${CONTEXT})"
set +e
OUTPUT="$(cd "${APP_DIR}" && pnpm exec tsx scripts/check-trading-ops-smoke.ts 2>&1)"
RC=$?
set -e

if [[ "${RC}" -eq 0 ]]; then
  printf '%s\n' "${OUTPUT}"
  exit 0
fi

printf '%s\n' "${OUTPUT}" >&2
send_alert "$(printf 'Trading Ops smoke failed (%s).\n%s' "${CONTEXT}" "${OUTPUT}")"
exit "${RC}"
