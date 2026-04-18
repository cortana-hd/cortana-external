"""Strategy authority-tier synthesis for governed portfolio allocation."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping, Sequence

from evaluation.prediction_accuracy import default_prediction_root

AUTHORITY_SCHEMA_VERSION = 1
DEFAULT_STRATEGY_AUTHORITY_PATH = (
    default_prediction_root() / "reports" / "strategy-authority-tiers-latest.json"
)
VALID_AUTHORITY_TIERS = ("exploratory", "limited_trust", "trusted", "demoted")
VALID_AUTONOMY_MODES = ("advisory", "paper", "supervised_live", "guarded_live")
AUTHORITY_WEIGHTS = {
    "exploratory": 0.35,
    "limited_trust": 0.65,
    "trusted": 1.0,
    "demoted": 0.15,
}
DEFAULT_AUTONOMY_BY_TIER = {
    "exploratory": "advisory",
    "limited_trust": "paper",
    "trusted": "supervised_live",
    "demoted": "advisory",
}


def build_strategy_authority_tiers_artifact(
    strategy_rows: Sequence[Mapping[str, Any]],
    *,
    operator_rationale: Mapping[str, Mapping[str, Any]] | None = None,
    generated_at: datetime | None = None,
    root: Path | None = None,
) -> dict[str, Any]:
    ts = generated_at or datetime.now(UTC)
    families: list[dict[str, Any]] = []
    rationale_by_family = {
        str(key).strip().lower(): dict(value)
        for key, value in (operator_rationale or {}).items()
        if str(key).strip()
    }
    for raw_row in strategy_rows:
        if not isinstance(raw_row, Mapping):
            continue
        row = dict(raw_row)
        family = str(row.get("strategy_family") or "").strip().lower()
        if not family:
            continue
        families.append(
            synthesize_strategy_authority_row(
                row,
                operator_rationale=rationale_by_family.get(family),
            )
        )

    authority_counts: dict[str, int] = {}
    autonomy_counts: dict[str, int] = {}
    for row in families:
        authority_tier = str(row.get("authority_tier") or "exploratory")
        autonomy_mode = str(row.get("autonomy_mode") or "advisory")
        authority_counts[authority_tier] = authority_counts.get(authority_tier, 0) + 1
        autonomy_counts[autonomy_mode] = autonomy_counts.get(autonomy_mode, 0) + 1

    artifact = {
        "artifact_family": "strategy_authority_tiers_v1",
        "schema_version": AUTHORITY_SCHEMA_VERSION,
        "generated_at": ts.isoformat(),
        "families": families,
        "authority_counts": authority_counts,
        "autonomy_counts": autonomy_counts,
        "summary": {
            "trusted_families": [
                row["strategy_family"] for row in families if row.get("authority_tier") == "trusted"
            ],
            "demoted_families": [
                row["strategy_family"] for row in families if row.get("authority_tier") == "demoted"
            ],
            "highest_autonomy_mode": _highest_autonomy_mode(
                str(row.get("autonomy_mode") or "advisory") for row in families
            ),
        },
    }

    target = root or DEFAULT_STRATEGY_AUTHORITY_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    return artifact


def synthesize_strategy_authority_row(
    strategy_row: Mapping[str, Any],
    *,
    operator_rationale: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    row = dict(strategy_row)
    rationale = dict(operator_rationale or {})
    family = str(row.get("strategy_family") or "").strip().lower()
    sample_depth = int(row.get("sample_depth", 0) or 0)
    health_status = str(row.get("health_status") or "warming").strip().lower()
    profit_factor = _optional_float(row.get("profit_factor"))
    hit_rate = _optional_float(row.get("hit_rate"))
    avg_return_pct = _optional_float(row.get("avg_return_pct"))
    max_drawdown_pct = abs(_optional_float(row.get("max_drawdown")) or 0.0)
    raw_regime_coverage = row.get("regime_coverage")
    if isinstance(raw_regime_coverage, Mapping):
        regime_coverage = dict(raw_regime_coverage)
        regime_count = int(regime_coverage.get("regime_count", 0) or 0)
    elif isinstance(raw_regime_coverage, Sequence) and not isinstance(raw_regime_coverage, (str, bytes)):
        regime_segments = [dict(item) for item in raw_regime_coverage if isinstance(item, Mapping)]
        regime_count = len(regime_segments)
        regime_coverage = {
            "regime_count": regime_count,
            "segments": regime_segments,
        }
    else:
        regime_coverage = {}
        regime_count = 0
    warnings = [str(item).strip() for item in row.get("warnings") or [] if str(item).strip()]

    reasons: list[str] = []
    blockers: list[str] = []
    authority_tier = "exploratory"

    if bool(rationale.get("force_demote")):
        authority_tier = "demoted"
        reasons.append("operator forced a demotion")
        blockers.append("operator_demoted")
    elif health_status == "stale":
        authority_tier = "demoted"
        reasons.append("summary is stale")
        blockers.append("stale_summary")
    elif avg_return_pct is not None and avg_return_pct < 0:
        authority_tier = "demoted"
        reasons.append("average return is negative")
        blockers.append("negative_average_return")
    elif max_drawdown_pct >= 8.0:
        authority_tier = "demoted"
        reasons.append("drawdown exceeds the trusted ceiling")
        blockers.append("drawdown_ceiling_breached")
    elif (
        health_status == "fresh"
        and sample_depth >= 20
        and (profit_factor or 0.0) >= 1.05
        and (hit_rate or 0.0) >= 0.5
        and regime_count >= 2
    ):
        authority_tier = "trusted"
        reasons.append("fresh evidence, adequate sample depth, and regime coverage support supervised-live authority")
    elif sample_depth >= 5 and health_status in {"fresh", "degraded"}:
        authority_tier = "limited_trust"
        reasons.append("evidence is usable, but not yet strong enough for supervised-live authority")
    else:
        authority_tier = "exploratory"
        reasons.append("family is still warming and should remain advisory only")

    autonomy_mode = str(
        rationale.get("autonomy_mode")
        or DEFAULT_AUTONOMY_BY_TIER.get(authority_tier, "advisory")
    ).strip().lower()
    if autonomy_mode not in VALID_AUTONOMY_MODES:
        autonomy_mode = DEFAULT_AUTONOMY_BY_TIER.get(authority_tier, "advisory")

    return {
        "strategy_family": family,
        "schema_version": "strategy_authority_tier.v1",
        "generated_at": _normalize_timestamp(rationale.get("generated_at")),
        "authority_tier": authority_tier,
        "autonomy_mode": autonomy_mode,
        "sample_depth": sample_depth,
        "benchmark_summary": {
            "profit_factor": profit_factor,
            "hit_rate": hit_rate,
            "avg_return_pct": avg_return_pct,
        },
        "drawdown_summary": {
            "max_drawdown_pct": round(max_drawdown_pct, 4),
            "health_status": health_status,
        },
        "regime_coverage": regime_coverage,
        "decision_reason": {
            "reasons": reasons,
            "blocking_factors": blockers,
            "warnings": warnings,
            "operator_rationale": rationale,
            "authority_weight": AUTHORITY_WEIGHTS[authority_tier],
        },
    }


def load_strategy_authority_tiers(path: Path | None = None) -> dict[str, Any]:
    target = (path or DEFAULT_STRATEGY_AUTHORITY_PATH).expanduser()
    if not target.exists():
        return {}
    payload = json.loads(target.read_text(encoding="utf-8"))
    return dict(payload) if isinstance(payload, dict) else {}


def authority_weight_for_tier(authority_tier: object) -> float:
    return float(AUTHORITY_WEIGHTS.get(str(authority_tier or "").strip().lower(), 0.35))


def _optional_float(value: object) -> float | None:
    try:
        if value is None or value == "":
            return None
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric != numeric:
        return None
    return round(numeric, 4)


def _normalize_timestamp(value: object) -> str:
    if isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            parsed = datetime.now(UTC)
    else:
        parsed = datetime.now(UTC)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).isoformat()


def _highest_autonomy_mode(values: Sequence[str] | Any) -> str:
    order = {mode: idx for idx, mode in enumerate(VALID_AUTONOMY_MODES)}
    best = "advisory"
    for raw in values:
        mode = str(raw or "").strip().lower()
        if order.get(mode, -1) > order.get(best, -1):
            best = mode
    return best
