#!/bin/bash

set -euo pipefail

SERVICE_LABEL="com.cortana.mission-control"
PLIST_PATH="${HOME}/Library/LaunchAgents/${SERVICE_LABEL}.plist"
HEALTH_URL="${MISSION_CONTROL_HEALTH_URL:-http://127.0.0.1:3000/api/heartbeat-status}"
BUILD=1
RUN_SMOKE=1

usage() {
  cat <<'EOF'
Usage: restart-mission-control.sh [--skip-build] [--health-url URL]

Rebuilds the Mission Control app, restarts the launchd-managed service,
and waits for the health endpoint to return successfully.

Options:
  --skip-build       Restart without running pnpm build first
  --skip-smoke       Skip Trading Ops smoke validation after health check
  --health-url URL   Override the health check URL
  -h, --help         Show this help text
EOF
}

log() {
  printf '[mission-control-restart] %s\n' "$*"
}

notify_failure() {
  local title="$1"
  local detail="$2"
  local guard="${TRADING_OPS_GUARD_BIN:-${CORTANA_REPO}/tools/notifications/telegram-delivery-guard.sh}"

  if [[ ! -x "${guard}" ]]; then
    echo "${title} ${detail}" >&2
    return 0
  fi

  "${guard}" \
    "$(printf '%s\n%s' "${title}" "${detail}")" \
    "8171372724" \
    "" \
    "mission_control:restart_failed" \
    "critical" \
    "monitor" \
    "Mission Control" \
    "now" \
    "restart-mission-control" >/dev/null 2>&1 || true
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build)
      BUILD=0
      shift
      ;;
    --skip-smoke)
      RUN_SMOKE=0
      shift
      ;;
    --health-url)
      if [[ $# -lt 2 ]]; then
        echo "--health-url requires a value" >&2
        exit 1
      fi
      HEALTH_URL="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required but was not found in PATH." >&2
  exit 1
fi

if ! command -v launchctl >/dev/null 2>&1; then
  echo "launchctl is required but was not found in PATH." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${APP_DIR}/../.." && pwd)"
DEV_ROOT="$(cd "${REPO_ROOT}/.." && pwd)"
CORTANA_REPO="${CORTANA_SOURCE_REPO:-${DEV_ROOT}/cortana}"

if [[ ! -f "${PLIST_PATH}" ]]; then
  echo "Mission Control LaunchAgent plist not found at ${PLIST_PATH}" >&2
  exit 1
fi

if [[ "${BUILD}" -eq 1 ]]; then
  log "Building Mission Control in ${APP_DIR}"
  if ! (
    cd "${APP_DIR}"
    pnpm build
  ); then
    notify_failure "Mission Control build failed during restart." "Run ./restart-mission-control.sh locally and inspect the build output."
    exit 1
  fi
else
  log "Skipping build"
fi

log "Stopping existing Mission Control processes"
launchctl bootout "gui/$(id -u)" "${PLIST_PATH}" 2>/dev/null || true
launchctl remove "${SERVICE_LABEL}" 2>/dev/null || true

if pids="$(/usr/sbin/lsof -tiTCP:3000 -sTCP:LISTEN 2>/dev/null)" && [[ -n "${pids}" ]]; then
  while IFS= read -r pid; do
    [[ -n "${pid}" ]] && kill "${pid}" 2>/dev/null || true
  done <<< "${pids}"
fi

pkill -f "${REPO_ROOT}/apps/mission-control" || true
pkill -f next-server || true

log "Starting ${SERVICE_LABEL} via launchd"
launchctl bootstrap "gui/$(id -u)" "${PLIST_PATH}" 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/${SERVICE_LABEL}"

log "Waiting for Mission Control health check at ${HEALTH_URL}"
for _ in $(seq 1 20); do
  if response="$(curl -fsS "${HEALTH_URL}" 2>/dev/null)"; then
    log "Mission Control is healthy"
    printf '%s\n' "${response}"
    if [[ "${RUN_SMOKE}" -eq 1 ]]; then
      log "Running Trading Ops smoke validation"
      if ! "${SCRIPT_DIR}/run-trading-ops-smoke-guard.sh" restart; then
        exit 1
      fi
    fi
    exit 0
  fi
  sleep 1
done

echo "Mission Control restart completed, but the health check did not pass: ${HEALTH_URL}" >&2
notify_failure "Mission Control restart health check failed." "Health endpoint did not recover after restart: ${HEALTH_URL}"
exit 1
