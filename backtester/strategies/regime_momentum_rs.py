"""Regime-aware momentum and relative-strength challenger family."""

from __future__ import annotations

from typing import Iterable, Mapping

from scoring.opportunity_score import build_opportunity_score_payload


def rank_regime_momentum_rs_candidates(
    feature_records: Iterable[Mapping[str, object]],
    *,
    market_regime: str,
    limit: int = 10,
) -> list[dict]:
    ranked: list[dict] = []
    for record in feature_records:
        symbol = str(record.get("symbol") or "").strip().upper()
        if not symbol:
            continue
        payload = build_opportunity_score_payload(
            symbol=symbol,
            strategy_family="regime_momentum_rs",
            feature_record=record,
            market_regime=market_regime,
            calibrated_confidence=record.get("calibrated_confidence", record.get("confidence")),
            downside_risk=record.get("downside_risk", record.get("downside_penalty")),
            benchmark_context={
                "prefilter_score": record.get("prefilter_score"),
                "relative_strength_63d": record.get("relative_strength_63d"),
            },
        )
        ranked.append(
            {
                "symbol": symbol,
                "strategy_family": "regime_momentum_rs",
                "opportunity_score": payload["opportunity_score"],
                "action": payload["action_label"],
                "calibrated_confidence": payload["calibrated_confidence"],
                "downside_risk": payload["downside_risk"],
                "feature_summary": payload["feature_summary"],
            }
        )
    ranked.sort(
        key=lambda item: (
            -float(item.get("opportunity_score", 0.0) or 0.0),
            -float(item.get("calibrated_confidence", 0.0) or 0.0),
            str(item.get("symbol", "")),
        )
    )
    return ranked[:limit]
