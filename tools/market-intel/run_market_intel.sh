#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/hd/Developer/cortana-external"
PKG_DIR="$ROOT/packages/market-intel"
BACKTESTER_DIR="${BACKTESTER_DIR:-$ROOT/backtester}"
PYTHON_BIN="${PYTHON_BIN:-$ROOT/backtester/.venv/bin/python}"
REGIME_PATH="${REGIME_PATH:-$ROOT/.cache/market_regime_snapshot_SPY.json}"
BRIDGE_VERIFY_SCRIPT="${BRIDGE_VERIFY_SCRIPT:-$ROOT/tools/market-intel/verify_backtester_bridge.py}"
MAX_ARTIFACT_AGE_HOURS="${MAX_ARTIFACT_AGE_HOURS:-8}"
MIN_TOP_MARKETS="${MIN_TOP_MARKETS:-1}"
MIN_WATCHLIST_COUNT="${MIN_WATCHLIST_COUNT:-1}"
MAX_FALLBACK_ONLY="${MAX_FALLBACK_ONLY:-2}"

# 1. Refresh the authoritative Python market-regime snapshot first.
cd "$BACKTESTER_DIR"
MARKET_REGIME_CACHE_PATH="$REGIME_PATH" "$PYTHON_BIN" -c "from data.market_regime import MarketRegimeDetector; MarketRegimeDetector().get_status()" >/dev/null

# 2. Build Polymarket context against the fresh regime snapshot.
cd "$PKG_DIR"
pnpm smoke
pnpm integrate
pnpm watchdog -- --regime "$REGIME_PATH" --require-regime --max-age-hours "$MAX_ARTIFACT_AGE_HOURS" --min-top-markets "$MIN_TOP_MARKETS" --min-watchlist-count "$MIN_WATCHLIST_COUNT"
pnpm registry-audit -- --max-fallback-only "$MAX_FALLBACK_ONLY"

# 3. Verify Python can consume the resulting artifacts before alerts run.
cd "$ROOT"
"$PYTHON_BIN" "$BRIDGE_VERIFY_SCRIPT" >/dev/null
