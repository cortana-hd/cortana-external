from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

from data.liquidity_model import LiquidityOverlayModel
from data.universe_selection import RankedUniverseSelector


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


def test_selector_keeps_priority_symbols_pinned_and_ranks_remaining(tmp_path):
    selector = RankedUniverseSelector(cache_path=tmp_path / "prefilter.json")

    benchmark = _history([100 + i * 0.15 for i in range(120)], [10_000_000.0] * 120)
    histories = {
        "SPY": benchmark,
        "AAA": _history([100 + i * 0.03 for i in range(120)], [600_000.0] * 120),
        "BBB": _history([100 + i * 0.20 for i in range(120)], [2_000_000.0] * 120),
        "CCC": _history([100 + i * 0.35 for i in range(120)], [4_500_000.0] * 120),
    }
    selector._fetch_histories = lambda symbols: histories  # type: ignore[method-assign]

    result = selector.select_live_universe(
        base_symbols=["AAA", "BBB", "CCC"],
        priority_symbols=["ZZZ", "BBB"],
        universe_size=3,
        market_regime="confirmed_uptrend",
        refresh=True,
    )

    assert result.symbols == ["ZZZ", "BBB", "CCC"]
    assert result.priority_symbols == ["ZZZ", "BBB"]
    assert result.ranked_symbols == ["CCC"]
    assert result.source == "live_refresh"
    assert Path(selector.cache_path).exists()


def test_selector_uses_execution_quality_overlay_to_break_ties(tmp_path):
    selector = RankedUniverseSelector(cache_path=tmp_path / "prefilter.json")

    closes = [100 + i * 0.20 for i in range(120)]
    benchmark = _history([100 + i * 0.15 for i in range(120)], [10_000_000.0] * 120)
    histories = {
        "SPY": benchmark,
        "AAA": _history(closes, [5_000.0] * 120),
        "BBB": _history(closes, [5_000_000.0] * 120),
    }
    selector._fetch_histories = lambda symbols: histories  # type: ignore[method-assign]

    result = selector.select_live_universe(
        base_symbols=["AAA", "BBB"],
        priority_symbols=[],
        universe_size=2,
        market_regime="confirmed_uptrend",
        refresh=True,
    )

    assert result.symbols == ["BBB", "AAA"]
    assert result.ranked_symbols == ["BBB", "AAA"]
    payload = json.loads(Path(selector.cache_path).read_text(encoding="utf-8"))
    assert payload["liquidity_overlay"]["symbol_count"] == 2
    assert payload["liquidity_overlay"]["summary"]["median_estimated_slippage_bps"] is not None


def test_selector_uses_fresh_cache_when_available(tmp_path):
    cache_path = tmp_path / "prefilter.json"
    payload = {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "symbols": [
            {"symbol": "AAA", "prefilter_score": 45.0},
            {"symbol": "BBB", "prefilter_score": 88.0},
            {"symbol": "CCC", "prefilter_score": 70.0},
        ],
    }
    cache_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    selector = RankedUniverseSelector(cache_path=cache_path)
    result = selector.select_live_universe(
        base_symbols=["AAA", "BBB", "CCC", "DDD"],
        priority_symbols=["AAA"],
        universe_size=4,
        market_regime="confirmed_uptrend",
    )

    assert result.symbols == ["AAA", "BBB", "CCC", "DDD"]
    assert result.source == "cache"
    assert result.unscored_symbols == ["DDD"]


def test_selector_falls_back_to_prefilter_when_liquidity_overlay_cache_is_missing(tmp_path):
    cache_path = tmp_path / "prefilter.json"
    payload = {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "symbols": [
            {"symbol": "AAA", "prefilter_score": 88.0},
            {"symbol": "BBB", "prefilter_score": 70.0},
        ],
    }
    cache_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    selector = RankedUniverseSelector(cache_path=cache_path)
    selector.liquidity_model.cache_path = tmp_path / "missing-liquidity-overlay.json"

    result = selector.select_live_universe(
        base_symbols=["AAA", "BBB"],
        priority_symbols=[],
        universe_size=2,
        market_regime="confirmed_uptrend",
    )

    assert result.symbols == ["AAA", "BBB"]
    assert result.source == "cache"


def test_selector_falls_back_to_deterministic_order_when_cache_missing(tmp_path):
    selector = RankedUniverseSelector(cache_path=tmp_path / "missing-prefilter.json")

    result = selector.select_live_universe(
        base_symbols=["BBB", "AAA", "CCC"],
        priority_symbols=["ZZZ"],
        universe_size=3,
        market_regime="confirmed_uptrend",
    )

    assert result.symbols == ["ZZZ", "BBB", "AAA"]
    assert result.source == "fallback"
    assert result.ranked_symbols == []
    assert result.generated_at is None


def test_selector_does_not_inline_refresh_when_cache_missing_even_if_allowed(tmp_path):
    selector = RankedUniverseSelector(cache_path=tmp_path / "missing-prefilter.json")

    result = selector.select_live_universe(
        base_symbols=["BBB", "AAA", "CCC"],
        priority_symbols=["ZZZ"],
        universe_size=3,
        market_regime="confirmed_uptrend",
        allow_inline_refresh=True,
    )

    assert result.symbols == ["ZZZ", "BBB", "AAA"]
    assert result.source == "fallback"


def test_selector_applies_liquidity_overlay_as_lightweight_rank_modifier(tmp_path):
    prefilter_path = tmp_path / "prefilter.json"
    liquidity_path = tmp_path / "liquidity.json"
    prefilter_payload = {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "symbols": [
            {"symbol": "AAA", "prefilter_score": 80.5},
            {"symbol": "BBB", "prefilter_score": 80.0},
        ],
    }
    liquidity_payload = {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "symbols": [
            {"symbol": "AAA", "liquidity_quality_score": 28.0, "liquidity_tier": "illiquid"},
            {"symbol": "BBB", "liquidity_quality_score": 90.0, "liquidity_tier": "high"},
        ],
    }
    prefilter_path.write_text(json.dumps(prefilter_payload, indent=2) + "\n", encoding="utf-8")
    liquidity_path.write_text(json.dumps(liquidity_payload, indent=2) + "\n", encoding="utf-8")

    selector = RankedUniverseSelector(
        cache_path=prefilter_path,
        liquidity_model=LiquidityOverlayModel(cache_path=liquidity_path),
    )
    result = selector.select_live_universe(
        base_symbols=["AAA", "BBB"],
        priority_symbols=[],
        universe_size=2,
        market_regime="confirmed_uptrend",
    )

    assert result.symbols == ["BBB", "AAA"]
    assert result.source == "cache"
