"""Strategy evaluation summaries and trust-state artifacts for Backtester V2."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timezone
from pathlib import Path
from typing import Iterable, Mapping, Optional

from evaluation.prediction_accuracy import default_prediction_root
from evaluation.regime_slices import build_regime_slice_summary

STRATEGY_SCORECARD_SCHEMA_VERSION = 1
STRATEGY_SCORECARD_WINDOWS = ("20", "50", "100")
REGISTERED_STRATEGY_FAMILIES = ("canslim", "dip_buyer", "regime_momentum_rs")


def build_strategy_scorecard_artifact(
    records: Iterable[Mapping[str, object]],
    *,
    root: Optional[Path] = None,
    generated_at: Optional[datetime] = None,
) -> dict:
    ts = generated_at or datetime.now(timezone.utc)
    payload_records = [dict(record) for record in records if isinstance(record, Mapping)]
    reports_dir = (root or default_prediction_root()) / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    strategy_rows = []
    for strategy in REGISTERED_STRATEGY_FAMILIES:
        strategy_records = [record for record in payload_records if str(record.get("strategy") or "") == strategy]
        strategy_rows.append(_build_strategy_row(strategy, strategy_records))

    trust_state = _overall_trust_state(strategy_rows)
    artifact = {
        "schema_version": STRATEGY_SCORECARD_SCHEMA_VERSION,
        "artifact_family": "strategy_scorecard_summary",
        "generated_at": ts.isoformat(),
        "overall_state": trust_state["state"],
        "overall_message": trust_state["message"],
        "strategies": strategy_rows,
    }
    (reports_dir / "strategy-scorecard-latest.json").write_text(json.dumps(artifact, indent=2), encoding="utf-8")

    shadow_artifact = build_shadow_comparison_artifact(payload_records, generated_at=ts)
    (reports_dir / "opportunity-shadow-latest.json").write_text(json.dumps(shadow_artifact, indent=2), encoding="utf-8")
    return artifact


def build_shadow_comparison_artifact(
    records: Iterable[Mapping[str, object]],
    *,
    generated_at: Optional[datetime] = None,
) -> dict:
    ts = generated_at or datetime.now(timezone.utc)
    grouped: dict[str, list[dict]] = {strategy: [] for strategy in REGISTERED_STRATEGY_FAMILIES}
    for record in records:
        if not isinstance(record, Mapping):
            continue
        strategy = str(record.get("strategy") or "unknown")
        grouped.setdefault(strategy, []).append(dict(record))

    comparisons = []
    for strategy in REGISTERED_STRATEGY_FAMILIES:
        strategy_records = grouped.get(strategy, [])
        if not strategy_records:
            comparisons.append(
                {
                    "strategy_family": strategy,
                    "sample_depth": 0,
                    "agreement_rate": 0.0,
                    "avg_opportunity_score": None,
                    "avg_legacy_score": None,
                    "avg_score_delta": None,
                    "state": "warming",
                }
            )
            continue
        agreement = 0
        opportunity_scores = []
        legacy_scores = []
        for record in strategy_records:
            action = str(record.get("action") or "UNKNOWN")
            shadow_action = str(record.get("v2_action_label") or record.get("action_label") or action)
            if shadow_action == action:
                agreement += 1
            opportunity = _float_or_none(record.get("opportunity_score"))
            legacy = _float_or_none(record.get("score"))
            if opportunity is not None:
                opportunity_scores.append(opportunity)
            if legacy is not None:
                legacy_scores.append(legacy)
        avg_opportunity = _mean(opportunity_scores)
        avg_legacy = _mean(legacy_scores)
        comparisons.append(
            {
                "strategy_family": strategy,
                "sample_depth": len(strategy_records),
                "agreement_rate": round(agreement / max(len(strategy_records), 1), 4),
                "avg_opportunity_score": round(avg_opportunity, 4) if avg_opportunity is not None else None,
                "avg_legacy_score": round(avg_legacy, 4) if avg_legacy is not None else None,
                "avg_score_delta": round(avg_opportunity - avg_legacy, 4)
                if avg_opportunity is not None and avg_legacy is not None
                else None,
                "state": "fresh" if len(strategy_records) >= 10 else "warming",
            }
        )
    return {
        "schema_version": STRATEGY_SCORECARD_SCHEMA_VERSION,
        "artifact_family": "opportunity_shadow_summary",
        "generated_at": ts.isoformat(),
        "comparisons": comparisons,
    }


def _build_strategy_row(strategy: str, records: list[dict]) -> dict:
    sample_depth = len(records)
    avg_return = _mean(
        [
            value
            for value in (
                _float_or_none(record.get("forward_return_5d_pct"))
                or _float_or_none((record.get("forward_returns_pct") or {}).get("5d"))
                or _float_or_none(record.get("return_5d"))
                for record in records
            )
            if value is not None
        ]
    )
    hit_rate = _mean(
        [
            1.0
            if (
                (_float_or_none(record.get("forward_return_5d_pct")) or _float_or_none((record.get("forward_returns_pct") or {}).get("5d")) or 0.0)
                > 0
            )
            else 0.0
            for record in records
        ]
    )
    downside_values = [
        value
        for value in (_float_or_none(record.get("downside_risk")) for record in records)
        if value is not None
    ]
    opportunity_values = [
        value
        for value in (_float_or_none(record.get("opportunity_score")) for record in records)
        if value is not None
    ]
    regime_coverage = build_regime_slice_summary(records)
    health = _health_status(records, sample_depth=sample_depth)
    warnings = []
    if sample_depth < 5:
        warnings.append("warming_sample_depth")
    if not opportunity_values:
        warnings.append("missing_opportunity_score")
    calibrated_confidence_values = [
        value
        for value in (_float_or_none(record.get("calibrated_confidence")) for record in records)
        if value is not None
    ]
    shadow_deltas = [
        (_float_or_none(record.get("opportunity_score")) or 0.0) - (_float_or_none(record.get("score")) or 0.0)
        for record in records
        if _float_or_none(record.get("opportunity_score")) is not None and _float_or_none(record.get("score")) is not None
    ]
    avg_calibrated_confidence = _mean(calibrated_confidence_values)
    shadow_vs_legacy = _mean(shadow_deltas)
    return {
        "strategy_family": strategy,
        "evaluation_window": "rolling",
        "sample_depth": sample_depth,
        "profit_factor": round(_profit_factor(records), 4) if records else None,
        "max_drawdown": round(_mean([
            abs(_float_or_none(record.get("max_adverse_excursion_pct", {}).get("5d")) or 0.0)
            for record in records
        ]), 4)
        if records
        else None,
        "avg_return_pct": round(avg_return, 4) if avg_return is not None else None,
        "hit_rate": round(hit_rate, 4) if hit_rate is not None else None,
        "avg_opportunity_score": round(_mean(opportunity_values), 4) if opportunity_values else None,
        "avg_downside_risk": round(_mean(downside_values), 4) if downside_values else None,
        "regime_coverage": regime_coverage,
        "calibration_summary": {
            "avg_calibrated_confidence": round(avg_calibrated_confidence, 4)
            if avg_calibrated_confidence is not None
            else None,
        },
        "benchmark_ladder": {
            "window_keys": list(STRATEGY_SCORECARD_WINDOWS),
            "shadow_vs_legacy": round(shadow_vs_legacy, 4) if shadow_vs_legacy is not None else None,
        },
        "health_status": health,
        "warnings": warnings,
    }


def _profit_factor(records: list[dict]) -> float:
    gains = 0.0
    losses = 0.0
    for record in records:
        value = _float_or_none(record.get("forward_return_5d_pct"))
        if value is None:
            value = _float_or_none((record.get("forward_returns_pct") or {}).get("5d"))
        if value is None:
            continue
        if value > 0:
            gains += value
        else:
            losses += abs(value)
    if losses <= 0:
        return gains if gains > 0 else 0.0
    return gains / losses


def _health_status(records: list[dict], *, sample_depth: int) -> str:
    if sample_depth == 0:
        return "warming"
    latest_generated_at = _latest_timestamp(records)
    if latest_generated_at is None:
        return "degraded"
    age_seconds = max((datetime.now(UTC) - latest_generated_at).total_seconds(), 0.0)
    if age_seconds > 24 * 60 * 60:
        return "stale"
    if sample_depth < 5:
        return "warming"
    if sample_depth < 20:
        return "degraded"
    return "fresh"


def _overall_trust_state(strategy_rows: list[dict]) -> dict:
    states = [str(row.get("health_status") or "warming") for row in strategy_rows]
    if any(state == "stale" for state in states):
        return {"state": "stale", "message": "At least one strategy summary is stale."}
    if any(state == "degraded" for state in states):
        return {"state": "degraded", "message": "Signal trust is degraded; sample depth or freshness is still weak."}
    if all(state == "warming" for state in states):
        return {"state": "warming", "message": "Signal trust is still warming up; not enough settled evidence yet."}
    return {"state": "fresh", "message": "Signal trust summaries are fresh and benchmarkable."}


def _latest_timestamp(records: list[dict]) -> datetime | None:
    latest: datetime | None = None
    for record in records:
        raw = record.get("predicted_at") or record.get("generated_at")
        if not isinstance(raw, str) or not raw.strip():
            continue
        try:
            parsed = datetime.fromisoformat(raw)
        except ValueError:
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        if latest is None or parsed > latest:
            latest = parsed
    return latest


def _float_or_none(value: object) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _mean(values: list[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)
