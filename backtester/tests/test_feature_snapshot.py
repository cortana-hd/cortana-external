from __future__ import annotations

from datetime import UTC, datetime

import pandas as pd

from data.feature_snapshot import build_feature_snapshot, extract_feature_records


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


def test_build_feature_snapshot_is_deterministic_for_fixed_input():
    generated_at = datetime(2026, 3, 19, 10, 0, tzinfo=UTC)
    histories = {
        "SPY": _history([100 + i * 0.10 for i in range(120)], [9_000_000.0] * 120),
        "AAA": _history([100 + i * 0.25 for i in range(120)], [2_000_000.0] * 120),
        "BBB": _history([100 + i * 0.05 for i in range(120)], [900_000.0] * 120),
    }

    snapshot_a = build_feature_snapshot(
        symbols=["AAA", "BBB"],
        histories=histories,
        market_regime="confirmed_uptrend",
        generated_at=generated_at,
        source="unit-test",
    )
    snapshot_b = build_feature_snapshot(
        symbols=["AAA", "BBB"],
        histories=histories,
        market_regime="confirmed_uptrend",
        generated_at=generated_at,
        source="unit-test",
    )

    assert snapshot_a == snapshot_b
    assert snapshot_a["schema_version"] == 1
    assert snapshot_a["symbol_count"] == 2
    assert "prefilter_score" in snapshot_a["feature_columns"]
    assert "return_5d" in snapshot_a["feature_columns"]
    assert snapshot_a["symbols"][0]["symbol"] == "AAA"
    assert snapshot_a["symbols"][0]["prefilter_score"] > snapshot_a["symbols"][1]["prefilter_score"]


def test_extract_feature_records_prefers_feature_snapshot_over_legacy_symbols():
    payload = {
        "symbols": [
            {"symbol": "AAA", "prefilter_score": 99.0},
            {"symbol": "BBB", "prefilter_score": 1.0},
        ],
        "feature_snapshot": {
            "symbols": [
                {"symbol": "AAA", "prefilter_score": 1.0},
                {"symbol": "BBB", "prefilter_score": 99.0},
            ]
        },
    }

    records = extract_feature_records(payload)
    assert [item["symbol"] for item in records] == ["AAA", "BBB"]
    assert records[0]["prefilter_score"] == 1.0
    assert records[1]["prefilter_score"] == 99.0
