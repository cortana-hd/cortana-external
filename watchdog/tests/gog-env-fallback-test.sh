#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; exit 1; }

STATE_FILE="$TMP_DIR/gateway-env.json"
PLIST_FILE="$TMP_DIR/ai.openclaw.gateway.plist"

cat >"$STATE_FILE" <<'EOF'
{
  "GOG_KEYRING_PASSWORD": "state-secret"
}
EOF

env -i \
  PATH="${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}" \
  HOME="$TMP_DIR/home" \
  OPENCLAW_GATEWAY_ENV_STATE_PATH="$STATE_FILE" \
  OPENCLAW_GATEWAY_PLIST="$PLIST_FILE" \
  bash -c '
    set -euo pipefail
    source "'"$ROOT_DIR/watchdog.sh"'"
    if [[ "${GOG_KEYRING_PASSWORD:-}" != "state-secret" ]]; then
      echo "expected state-secret, got ${GOG_KEYRING_PASSWORD:-<empty>}"
      exit 1
    fi
  ' >/dev/null

pass "watchdog loads GOG keyring password from durable OpenClaw env state"

echo "All watchdog Gog env fallback tests passed."
