"""Reusable precomputed feature snapshot for live universe ranking."""

from __future__ import annotations

import math
from datetime import UTC, datetime
from typing import Iterable, Optional

import pandas as pd


FEATURE_SNAPSHOT_SCHEMA_VERSION = 1
DEFAULT_BENCHMARK_SYMBOL = "SPY"
REQUIRED_OHLCV_COLUMNS = ("Open", "High", "Low", "Close", "Volume")
FEATURE_COLUMNS = (
    "prefilter_score",
    "relative_strength_score",
    "trend_quality_score",
    "liquidity_score",
    "distance_from_high_score",
    "pullback_shape_score",
    "volatility_sanity_score",
    "return_1d",
    "return_5d",
    "return_21d",
    "return_63d",
    "relative_strength_63d",
    "avg_dollar_volume_20d",
    "pct_from_high",
    "atr_pct",
)


def build_feature_snapshot(
    *,
    symbols: Iterable[str],
    histories: dict[str, pd.DataFrame],
    market_regime: str = "unknown",
    source: str = "universe_selection.refresh_cache",
    benchmark_symbol: str = DEFAULT_BENCHMARK_SYMBOL,
    generated_at: Optional[datetime] = None,
) -> dict:
    """Build a stable feature snapshot from pre-fetched histories."""
    ts = generated_at or datetime.now(UTC)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)

    benchmark = histories.get(benchmark_symbol)
    benchmark_close = _series_or_none(benchmark, "Close") if benchmark is not None else None

    scored: list[dict] = []
    seen: set[str] = set()
    for raw in symbols:
        symbol = str(raw or "").strip().upper()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        history = histories.get(symbol)
        if history is None:
            continue
        metrics = _score_symbol(
            symbol=symbol,
            history=history,
            benchmark_close=benchmark_close,
            market_regime=market_regime,
        )
        if metrics is not None:
            scored.append(metrics)

    return {
        "schema_version": FEATURE_SNAPSHOT_SCHEMA_VERSION,
        "generated_at": ts.isoformat(),
        "source": source,
        "market_regime": str(market_regime or "unknown"),
        "benchmark_symbol": benchmark_symbol,
        "symbol_count": len(scored),
        "feature_columns": list(FEATURE_COLUMNS),
        "symbols": scored,
        "provenance": {
            "history_columns": list(REQUIRED_OHLCV_COLUMNS),
            "history_period": "1y",
        },
    }


def extract_feature_records(payload: dict) -> list[dict]:
    """Extract symbol feature records from either the new or legacy payload shape."""
    snapshot = payload.get("feature_snapshot")
    if isinstance(snapshot, dict):
        symbols = snapshot.get("symbols")
        if isinstance(symbols, list):
            return [
                item
                for item in symbols
                if isinstance(item, dict) and str(item.get("symbol", "")).strip()
            ]
    symbols = payload.get("symbols")
    if isinstance(symbols, list):
        return [
            item
            for item in symbols
            if isinstance(item, dict) and str(item.get("symbol", "")).strip()
        ]
    return []


def _series_or_none(frame: Optional[pd.DataFrame], column: str) -> Optional[pd.Series]:
    if frame is None or frame.empty or column not in frame.columns:
        return None
    series = pd.to_numeric(frame[column], errors="coerce").dropna()
    if series.empty:
        return None
    return series


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _score_symbol(
    *,
    symbol: str,
    history: pd.DataFrame,
    benchmark_close: Optional[pd.Series],
    market_regime: str,
) -> Optional[dict]:
    if history is None or history.empty or len(history) < 80:
        return None

    close = _series_or_none(history, "Close")
    high = _series_or_none(history, "High")
    low = _series_or_none(history, "Low")
    volume = _series_or_none(history, "Volume")
    if close is None or high is None or low is None or volume is None:
        return None

    current = float(close.iloc[-1])
    if current <= 0:
        return None

    ma21 = float(close.rolling(21, min_periods=10).mean().iloc[-1])
    ma50 = float(close.rolling(50, min_periods=20).mean().iloc[-1])
    high_52w = float(close.max())
    pct_from_high = current / high_52w if high_52w > 0 else 0.0
    ret_1d = _period_return(close, 1)
    ret_5d = _period_return(close, 5)
    ret_21 = _period_return(close, 21)
    ret_63 = _period_return(close, 63)
    benchmark_ret_63 = _period_return(benchmark_close, 63) if benchmark_close is not None else 0.0
    relative_strength = ret_63 - benchmark_ret_63
    avg_dollar_volume = float((close * volume).rolling(20, min_periods=10).mean().iloc[-1])
    atr_pct = _atr_pct(high=high, low=low, close=close)

    rs_score = _clamp((relative_strength + 0.08) / 0.33)
    trend_score = min(
        1.0,
        (0.35 if current > ma21 else 0.0)
        + (0.35 if current > ma50 else 0.0)
        + (0.20 if ma21 > ma50 else 0.0)
        + (0.10 if ret_21 > 0 else 0.0),
    )
    liquidity_score = _clamp((math.log10(max(avg_dollar_volume, 1.0)) - 6.5) / 2.0)
    proximity_score = (
        1.0 if pct_from_high >= 0.95 else
        0.8 if pct_from_high >= 0.90 else
        0.55 if pct_from_high >= 0.82 else
        0.20 if pct_from_high >= 0.70 else
        0.0
    )

    pullback_depth = max(0.0, 1.0 - pct_from_high)
    if current > ma50 and 0.03 <= pullback_depth <= 0.12:
        pullback_score = 1.0
    elif current > ma21 and pullback_depth < 0.03:
        pullback_score = 0.7
    elif current > ma50 and pullback_depth <= 0.18:
        pullback_score = 0.5
    else:
        pullback_score = 0.0

    if 0.012 <= atr_pct <= 0.065:
        volatility_score = 1.0
    elif 0.006 <= atr_pct <= 0.10:
        volatility_score = 0.6
    elif atr_pct <= 0.14:
        volatility_score = 0.3
    else:
        volatility_score = 0.0

    weights = _weights_for_regime(market_regime)
    prefilter_score = round(
        100.0
        * (
            rs_score * weights["relative_strength"]
            + trend_score * weights["trend_quality"]
            + liquidity_score * weights["liquidity"]
            + proximity_score * weights["distance_from_high"]
            + pullback_score * weights["pullback_shape"]
            + volatility_score * weights["volatility_sanity"]
        ),
        2,
    )

    return {
        "symbol": symbol,
        "prefilter_score": prefilter_score,
        "relative_strength_score": round(rs_score, 4),
        "trend_quality_score": round(trend_score, 4),
        "liquidity_score": round(liquidity_score, 4),
        "distance_from_high_score": round(proximity_score, 4),
        "pullback_shape_score": round(pullback_score, 4),
        "volatility_sanity_score": round(volatility_score, 4),
        "return_1d": round(ret_1d, 4),
        "return_5d": round(ret_5d, 4),
        "return_21d": round(ret_21, 4),
        "return_63d": round(ret_63, 4),
        "relative_strength_63d": round(relative_strength, 4),
        "avg_dollar_volume_20d": round(avg_dollar_volume, 2),
        "pct_from_high": round(pct_from_high, 4),
        "atr_pct": round(atr_pct, 4),
    }


def _period_return(series: Optional[pd.Series], bars: int) -> float:
    if series is None or series.empty:
        return 0.0
    idx = min(len(series) - 1, bars)
    if idx <= 0:
        return 0.0
    start = float(series.iloc[-idx - 1])
    end = float(series.iloc[-1])
    if start <= 0:
        return 0.0
    return end / start - 1.0


def _atr_pct(high: pd.Series, low: pd.Series, close: pd.Series) -> float:
    tr = pd.concat(
        [
            (high - low).abs(),
            (high - close.shift(1)).abs(),
            (low - close.shift(1)).abs(),
        ],
        axis=1,
    ).max(axis=1)
    atr = float(tr.rolling(14, min_periods=5).mean().iloc[-1])
    current = float(close.iloc[-1])
    if current <= 0:
        return 0.0
    return atr / current


def _weights_for_regime(market_regime: str) -> dict[str, float]:
    if market_regime == "uptrend_under_pressure":
        return {
            "relative_strength": 0.22,
            "trend_quality": 0.28,
            "liquidity": 0.24,
            "distance_from_high": 0.10,
            "pullback_shape": 0.08,
            "volatility_sanity": 0.08,
        }
    if market_regime == "correction":
        return {
            "relative_strength": 0.18,
            "trend_quality": 0.30,
            "liquidity": 0.25,
            "distance_from_high": 0.07,
            "pullback_shape": 0.08,
            "volatility_sanity": 0.12,
        }
    return {
        "relative_strength": 0.28,
        "trend_quality": 0.26,
        "liquidity": 0.18,
        "distance_from_high": 0.10,
        "pullback_shape": 0.12,
        "volatility_sanity": 0.06,
    }
