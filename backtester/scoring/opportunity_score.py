"""Canonical opportunity-score computation for Backtester V2."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Mapping, Optional


OPPORTUNITY_SCORE_SCHEMA_VERSION = 1
OPPORTUNITY_SCORE_MAPPING_VERSION = "v2.1"
CANONICAL_HORIZON_LABEL = "1-5d"
CANONICAL_HORIZON_DAYS = 5


def build_opportunity_score_payload(
    *,
    symbol: str,
    strategy_family: str,
    feature_record: Mapping[str, object],
    market_regime: str,
    calibrated_confidence: float | None,
    downside_risk: float | None,
    generated_at: Optional[datetime] = None,
    known_at: Optional[datetime] = None,
    benchmark_context: Mapping[str, object] | None = None,
    warnings: list[str] | None = None,
) -> dict:
    score = compute_opportunity_score(
        strategy_family=strategy_family,
        feature_record=feature_record,
        market_regime=market_regime,
        calibrated_confidence=calibrated_confidence,
        downside_risk=downside_risk,
    )
    ts = generated_at or datetime.now(UTC)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    anchor = known_at or ts
    if anchor.tzinfo is None:
        anchor = anchor.replace(tzinfo=UTC)
    action_label = map_score_to_action(
        opportunity_score=score["opportunity_score"],
        calibrated_confidence=score["calibrated_confidence"],
        downside_risk=score["downside_risk"],
        market_regime=market_regime,
        strategy_family=strategy_family,
    )
    return {
        "schema_version": OPPORTUNITY_SCORE_SCHEMA_VERSION,
        "generated_at": ts.isoformat(),
        "known_at": anchor.isoformat(),
        "symbol": str(symbol or "").strip().upper(),
        "strategy_family": str(strategy_family or "").strip() or "unknown",
        "canonical_horizon": CANONICAL_HORIZON_LABEL,
        "canonical_horizon_days": CANONICAL_HORIZON_DAYS,
        "opportunity_score": score["opportunity_score"],
        "action_label": action_label,
        "calibrated_confidence": score["calibrated_confidence"],
        "downside_risk": score["downside_risk"],
        "regime_label": str(market_regime or "unknown"),
        "feature_summary": dict(feature_record.get("feature_summary") or {}),
        "benchmark_context": dict(benchmark_context or {}),
        "score_components": score["components"],
        "warnings": list(warnings or []),
        "score_mapping_version": OPPORTUNITY_SCORE_MAPPING_VERSION,
    }


def compute_opportunity_score(
    *,
    strategy_family: str,
    feature_record: Mapping[str, object],
    market_regime: str,
    calibrated_confidence: float | None,
    downside_risk: float | None,
) -> dict:
    normalized_confidence = _normalize_ratio(
        calibrated_confidence,
        fallback=feature_record.get("confidence", feature_record.get("effective_confidence")),
    )
    normalized_risk = _normalize_ratio(
        downside_risk,
        fallback=_derive_downside_risk(feature_record),
    )
    prefilter_score = _normalize_score(feature_record.get("prefilter_score"))
    rs_score = _normalize_ratio(feature_record.get("relative_strength_score"))
    trend_score = _normalize_ratio(feature_record.get("trend_quality_score"))
    pullback_score = _normalize_ratio(feature_record.get("pullback_shape_score"))
    liquidity_score = _normalize_ratio(feature_record.get("liquidity_score"))
    volatility_score = _normalize_ratio(feature_record.get("volatility_sanity_score"))
    regime_alignment = _normalize_ratio(feature_record.get("regime_alignment_score"))
    adverse_regime_penalty = min(1.0, max(_to_float(feature_record.get("adverse_regime_score")) / 100.0, 0.0))

    family = str(strategy_family or "").strip().lower()
    positives = (
        prefilter_score * 0.18
        + rs_score * _weight_for_family(family, "relative_strength")
        + trend_score * _weight_for_family(family, "trend_quality")
        + pullback_score * _weight_for_family(family, "pullback_shape")
        + liquidity_score * 0.10
        + volatility_score * 0.08
        + regime_alignment * 0.16
        + normalized_confidence * 0.16
    )
    penalties = normalized_risk * 0.18 + adverse_regime_penalty * 0.10 + _regime_penalty(market_regime, family)
    raw_score = max(0.0, min((positives - penalties) * 100.0, 100.0))

    return {
        "opportunity_score": round(raw_score, 2),
        "calibrated_confidence": round(normalized_confidence, 4),
        "downside_risk": round(normalized_risk, 4),
        "components": {
            "prefilter_score": round(prefilter_score, 4),
            "relative_strength_score": round(rs_score, 4),
            "trend_quality_score": round(trend_score, 4),
            "pullback_shape_score": round(pullback_score, 4),
            "liquidity_score": round(liquidity_score, 4),
            "volatility_score": round(volatility_score, 4),
            "regime_alignment_score": round(regime_alignment, 4),
            "adverse_regime_penalty": round(adverse_regime_penalty, 4),
        },
    }


def map_score_to_action(
    *,
    opportunity_score: float,
    calibrated_confidence: float,
    downside_risk: float,
    market_regime: str,
    strategy_family: str,
) -> str:
    family = str(strategy_family or "").strip().lower()
    if opportunity_score >= 70 and calibrated_confidence >= 0.58 and downside_risk <= 0.42:
        if market_regime == "correction" and family != "dip_buyer":
            return "WATCH"
        return "BUY"
    if opportunity_score >= 45 and calibrated_confidence >= 0.42:
        return "WATCH"
    return "NO_BUY"


def _weight_for_family(strategy_family: str, dimension: str) -> float:
    if strategy_family == "regime_momentum_rs":
        return {
            "relative_strength": 0.24,
            "trend_quality": 0.20,
            "pullback_shape": 0.06,
        }.get(dimension, 0.0)
    if strategy_family == "dip_buyer":
        return {
            "relative_strength": 0.10,
            "trend_quality": 0.14,
            "pullback_shape": 0.18,
        }.get(dimension, 0.0)
    return {
        "relative_strength": 0.18,
        "trend_quality": 0.16,
        "pullback_shape": 0.10,
    }.get(dimension, 0.0)


def _regime_penalty(market_regime: str, strategy_family: str) -> float:
    if market_regime == "correction" and strategy_family == "dip_buyer":
        return 0.04
    if market_regime == "correction":
        return 0.18
    if market_regime == "uptrend_under_pressure":
        return 0.08
    return 0.0


def _derive_downside_risk(feature_record: Mapping[str, object]) -> float:
    downside_penalty = _to_float(feature_record.get("downside_penalty"))
    if downside_penalty > 0:
        return min(max(downside_penalty / 10.0, 0.0), 1.0)
    pct_from_high = _to_float(feature_record.get("pct_from_high"))
    atr_pct = _to_float(feature_record.get("atr_pct"))
    adverse_regime_score = _to_float(feature_record.get("adverse_regime_score")) / 100.0
    drawdown_component = max(0.0, min((1.0 - pct_from_high) * 2.0, 1.0))
    volatility_component = max(0.0, min(atr_pct / 0.12, 1.0))
    return min(1.0, drawdown_component * 0.50 + volatility_component * 0.30 + adverse_regime_score * 0.20)


def _normalize_score(value: object) -> float:
    numeric = _to_float(value)
    if numeric <= 1.0:
        return max(numeric, 0.0)
    return min(max(numeric / 100.0, 0.0), 1.0)


def _normalize_ratio(value: object, *, fallback: object = None) -> float:
    numeric = _to_float(value)
    if numeric <= 0 and fallback is not None:
        numeric = _to_float(fallback)
    if numeric > 1.0:
        numeric /= 100.0
    return min(max(numeric, 0.0), 1.0)


def _to_float(value: object) -> float:
    try:
        if value is None:
            return 0.0
        return float(value)
    except (TypeError, ValueError):
        return 0.0

