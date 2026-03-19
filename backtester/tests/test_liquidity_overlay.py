from __future__ import annotations

import pandas as pd

from data.liquidity_model import LiquidityOverlayModel
from data.liquidity_overlay import build_execution_quality_overlay


def _history(closes: list[float], volumes: list[float] | None = None) -> pd.DataFrame:
    index = pd.date_range(start="2025-01-01", periods=len(closes), freq="B", tz="UTC")
    vols = volumes or [1_000_000.0] * len(closes)
    return pd.DataFrame(
        {
            "Open": closes,
            "High": [value * 1.01 for value in closes],
            "Low": [value * 0.99 for value in closes],
            "Close": closes,
            "Volume": vols,
        },
        index=index,
    )


def test_wrapper_builder_reads_cached_overlay_and_exposes_labels(tmp_path, monkeypatch):
    cache_path = tmp_path / "liquidity-overlay.json"
    model = LiquidityOverlayModel(cache_path=cache_path)
    model.refresh_cache(base_symbols=["MSFT"], histories={"MSFT": _history([100 + i * 0.2 for i in range(120)], [50_000_000.0] * 120)})
    monkeypatch.setenv("TRADING_LIQUIDITY_OVERLAY_PATH", str(cache_path))

    overlay = build_execution_quality_overlay(symbol="MSFT")

    assert overlay["symbol"] == "MSFT"
    assert overlay["execution_quality"] == "good"
    assert overlay["liquidity_posture"] == "high"
    assert overlay["slippage_risk"] == "high"
    assert overlay["annotation"]
