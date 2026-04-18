from __future__ import annotations

from datetime import UTC, datetime

import pandas as pd

from data.market_regime import MarketRegime, MarketStatus
from features.core_feature_bundle import build_core_feature_bundle


def _history(closes: list[float], volumes: list[float] | None = None) -> pd.DataFrame:
    index = pd.date_range(start="2026-01-01", periods=len(closes), freq="B", tz="UTC")
    return pd.DataFrame(
        {
            "Open": closes,
            "High": [value * 1.01 for value in closes],
            "Low": [value * 0.99 for value in closes],
            "Close": closes,
            "Volume": volumes or [1_500_000.0] * len(closes),
        },
        index=index,
    )


def _market_status() -> MarketStatus:
    return MarketStatus(
        regime=MarketRegime.CONFIRMED_UPTREND,
        distribution_days=2,
        last_ftd="2026-02-10",
        trend_direction="up",
        position_sizing=1.0,
        notes="Healthy tape.",
        data_source="test",
        provider_mode="test",
        status="ok",
        regime_score=5,
    )


def test_build_core_feature_bundle_is_deterministic_and_enriches_regime_context():
    generated_at = datetime(2026, 4, 10, 12, 0, tzinfo=UTC)
    payload = build_core_feature_bundle(
        symbols=["AAA", "BBB"],
        histories={
            "SPY": _history([100 + i * 0.10 for i in range(140)], [8_000_000.0] * 140),
            "AAA": _history([90 + i * 0.35 for i in range(140)], [2_500_000.0] * 140),
            "BBB": _history([90 + i * 0.08 for i in range(140)], [900_000.0] * 140),
        },
        market_regime="confirmed_uptrend",
        market_status=_market_status(),
        generated_at=generated_at,
        source="unit-test",
    )

    repeated = build_core_feature_bundle(
        symbols=["AAA", "BBB"],
        histories={
            "SPY": _history([100 + i * 0.10 for i in range(140)], [8_000_000.0] * 140),
            "AAA": _history([90 + i * 0.35 for i in range(140)], [2_500_000.0] * 140),
            "BBB": _history([90 + i * 0.08 for i in range(140)], [900_000.0] * 140),
        },
        market_regime="confirmed_uptrend",
        market_status=_market_status(),
        generated_at=generated_at,
        source="unit-test",
    )

    assert payload == repeated
    assert payload["schema_version"] == 1
    assert payload["status"] == "fresh"
    assert payload["regime_context"]["label"] == "confirmed_uptrend"
    assert payload["symbols"][0]["symbol"] == "AAA"
    assert payload["symbols"][0]["regime_alignment_score"] >= payload["symbols"][1]["regime_alignment_score"]
    assert "feature_summary" in payload["symbols"][0]

