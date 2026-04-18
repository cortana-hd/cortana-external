"""Canonical feature-bundle assembly for Backtester V2 signal intelligence."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Iterable, Mapping, Optional

import pandas as pd

from data.adverse_regime import build_adverse_regime_indicator
from data.feature_snapshot import build_feature_snapshot


CORE_FEATURE_BUNDLE_SCHEMA_VERSION = 1


def build_core_feature_bundle(
    *,
    symbols: Iterable[str],
    histories: dict[str, pd.DataFrame],
    market_regime: str = "unknown",
    market_status: object | None = None,
    risk_inputs: Mapping[str, object] | None = None,
    source: str = "backtester.features.core_feature_bundle",
    benchmark_symbol: str = "SPY",
    generated_at: Optional[datetime] = None,
) -> dict:
    """Build the V2 feature bundle on top of the stable feature snapshot path."""
    ts = generated_at or datetime.now(UTC)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)

    snapshot = build_feature_snapshot(
        symbols=symbols,
        histories=histories,
        market_regime=market_regime,
        source=source,
        benchmark_symbol=benchmark_symbol,
        generated_at=ts,
    )
    adverse_regime = build_adverse_regime_indicator(
        market=market_status,
        risk_inputs=dict(risk_inputs or {}),
    )
    regime_context = _build_regime_context(
        market_regime=market_regime,
        market_status=market_status,
        adverse_regime=adverse_regime,
    )
    records = [
        _augment_feature_record(item, regime_context=regime_context, adverse_regime=adverse_regime)
        for item in snapshot.get("symbols", [])
        if isinstance(item, dict)
    ]
    return {
        "schema_version": CORE_FEATURE_BUNDLE_SCHEMA_VERSION,
        "generated_at": ts.isoformat(),
        "source": source,
        "market_regime": str(market_regime or "unknown"),
        "benchmark_symbol": benchmark_symbol,
        "status": _bundle_status(records, regime_context=regime_context),
        "symbol_count": len(records),
        "feature_columns": [
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
            "regime_alignment_score",
            "adverse_regime_score",
        ],
        "regime_context": regime_context,
        "symbols": records,
        "provenance": snapshot.get("provenance", {}),
    }


def build_core_feature_record(
    *,
    symbol: str,
    history: pd.DataFrame,
    benchmark_history: pd.DataFrame | None = None,
    market_regime: str = "unknown",
    market_status: object | None = None,
    risk_inputs: Mapping[str, object] | None = None,
    generated_at: Optional[datetime] = None,
    source: str = "backtester.features.core_feature_bundle.single",
) -> dict | None:
    histories = {str(symbol).strip().upper(): history}
    if benchmark_history is not None:
        histories["SPY"] = benchmark_history
    payload = build_core_feature_bundle(
        symbols=[symbol],
        histories=histories,
        market_regime=market_regime,
        market_status=market_status,
        risk_inputs=risk_inputs,
        source=source,
        generated_at=generated_at,
    )
    records = payload.get("symbols") or []
    return records[0] if records else None


def extract_core_feature_records(payload: Mapping[str, object]) -> list[dict]:
    symbols = payload.get("symbols")
    if not isinstance(symbols, list):
        return []
    return [entry for entry in symbols if isinstance(entry, dict) and str(entry.get("symbol", "")).strip()]


def _build_regime_context(
    *,
    market_regime: str,
    market_status: object | None,
    adverse_regime: Mapping[str, object],
) -> dict:
    regime_value = str(
        getattr(getattr(market_status, "regime", None), "value", None) or market_regime or "unknown"
    ).strip() or "unknown"
    return {
        "label": regime_value,
        "status": str(getattr(market_status, "status", "ok") or "ok"),
        "regime_score": int(getattr(market_status, "regime_score", 0) or 0),
        "trend_direction": str(getattr(market_status, "trend_direction", "unknown") or "unknown"),
        "position_sizing_pct": round(float(getattr(market_status, "position_sizing", 0.0) or 0.0) * 100.0, 2),
        "distribution_days": int(getattr(market_status, "distribution_days", 0) or 0),
        "provider_mode": str(getattr(market_status, "provider_mode", "unknown") or "unknown"),
        "snapshot_age_seconds": float(getattr(market_status, "snapshot_age_seconds", 0.0) or 0.0),
        "adverse_regime": dict(adverse_regime),
    }


def _augment_feature_record(
    record: Mapping[str, object],
    *,
    regime_context: Mapping[str, object],
    adverse_regime: Mapping[str, object],
) -> dict:
    out = dict(record)
    market_regime = str(regime_context.get("label") or "unknown")
    adverse_score = float(adverse_regime.get("score", 0.0) or 0.0)
    out["regime_label"] = market_regime
    out["regime_status"] = str(regime_context.get("status") or "ok")
    out["regime_alignment_score"] = round(
        _regime_alignment(
            market_regime=market_regime,
            relative_strength=float(record.get("relative_strength_score", 0.0) or 0.0),
            trend_quality=float(record.get("trend_quality_score", 0.0) or 0.0),
        ),
        4,
    )
    out["adverse_regime_score"] = round(adverse_score, 2)
    out["adverse_regime_label"] = str(adverse_regime.get("label") or "normal")
    out["feature_summary"] = {
        "prefilter_score": float(record.get("prefilter_score", 0.0) or 0.0),
        "relative_strength_63d": float(record.get("relative_strength_63d", 0.0) or 0.0),
        "return_5d": float(record.get("return_5d", 0.0) or 0.0),
        "return_21d": float(record.get("return_21d", 0.0) or 0.0),
        "pct_from_high": float(record.get("pct_from_high", 0.0) or 0.0),
        "atr_pct": float(record.get("atr_pct", 0.0) or 0.0),
        "regime_alignment_score": out["regime_alignment_score"],
        "adverse_regime_score": out["adverse_regime_score"],
    }
    return out


def _regime_alignment(*, market_regime: str, relative_strength: float, trend_quality: float) -> float:
    if market_regime == "confirmed_uptrend":
        return min(1.0, 0.45 + relative_strength * 0.35 + trend_quality * 0.20)
    if market_regime == "uptrend_under_pressure":
        return min(1.0, 0.35 + relative_strength * 0.30 + trend_quality * 0.15)
    if market_regime == "correction":
        return max(0.0, 0.15 + trend_quality * 0.20 - relative_strength * 0.10)
    return min(1.0, 0.25 + relative_strength * 0.25 + trend_quality * 0.10)


def _bundle_status(records: list[dict], *, regime_context: Mapping[str, object]) -> str:
    if not records:
        return "warming"
    if str(regime_context.get("status") or "ok") == "degraded":
        return "degraded"
    return "fresh"

