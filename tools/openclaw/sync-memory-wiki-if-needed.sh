#!/usr/bin/env bash
set -euo pipefail

EXTERNAL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CORTANA_ROOT="${CORTANA_ROOT:-$HOME/Developer/cortana}"
DELEGATE="$CORTANA_ROOT/tools/openclaw/sync-memory-wiki-if-needed.sh"

if [[ ! -x "$DELEGATE" ]]; then
  echo "delegate script missing or not executable: $DELEGATE" >&2
  exit 1
fi

exec "$DELEGATE" --repo-root "$EXTERNAL_ROOT" "$@"
