#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
HOST_VALUE="${HOST:-0.0.0.0}"
PORT_VALUE="${PORT:-3000}"

cd "${APP_DIR}"

if [[ ! -f ".next/BUILD_ID" ]]; then
  echo "Mission Control build output is missing (.next/BUILD_ID). Run pnpm build before starting the launchd service." >&2
  exit 1
fi

NEXT_BIN="$(node -p 'require.resolve("next/dist/bin/next")')"

exec node "${NEXT_BIN}" start --hostname "${HOST_VALUE}" --port "${PORT_VALUE}"
