from __future__ import annotations

import pandas as pd

from data.liquidity_model import LiquidityOverlayModel


def _history(
    closes: list[float],
    volumes: list[float] | None = None,
    *,
    start: str = "2025-01-01",
) -> pd.DataFrame:
    index = pd.date_range(start=start, periods=len(closes), freq="B", tz="UTC")
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


def test_liquidity_overlay_scores_liquid_names_above_thin_names(tmp_path):
    model = LiquidityOverlayModel(cache_path=tmp_path / "liquidity-overlay.json")
    histories = {
        "LIQ": _history([100 + i * 0.15 for i in range(120)], [5_000_000.0] * 120),
        "THIN": _history([100 + i * 0.15 for i in range(120)], [5_000.0] * 120),
    }

    payload = model.refresh_cache(base_symbols=["LIQ", "THIN"], histories=histories)
    _, overlay_map = model.load_overlay_map()

    assert payload["summary"]["high_quality_count"] >= 1
    assert overlay_map["LIQ"]["liquidity_quality_score"] > overlay_map["THIN"]["liquidity_quality_score"]
    assert overlay_map["LIQ"]["estimated_slippage_bps"] < overlay_map["THIN"]["estimated_slippage_bps"]
    assert overlay_map["THIN"]["liquidity_tier"] in {"low", "illiquid"}


def test_liquidity_overlay_writes_atomic_cache_payload(tmp_path):
    cache_path = tmp_path / "liquidity-overlay.json"
    model = LiquidityOverlayModel(cache_path=cache_path)
    histories = {
        "AAA": _history([100 + i * 0.10 for i in range(120)], [2_000_000.0] * 120),
    }

    model.refresh_cache(base_symbols=["AAA"], histories=histories)

    assert cache_path.exists()
    assert not (tmp_path / "liquidity-overlay.json.tmp").exists()


def test_liquidity_overlay_payload_exposes_alert_friendly_aliases(tmp_path):
    model = LiquidityOverlayModel(cache_path=tmp_path / "liquidity-overlay.json")
    histories = {
        "AAA": _history([100 + i * 0.20 for i in range(120)], [50_000_000.0] * 120),
    }

    payload = model.refresh_cache(base_symbols=["AAA"], histories=histories)
    record = payload["symbols"][0]

    assert record["execution_quality"] == "good"
    assert record["liquidity_posture"] == record["liquidity_tier"]
    assert record["slippage_risk"] == "high"
    assert "liquidity" in record["annotation"].lower()
    assert "slippage" in record["summary"].lower()
