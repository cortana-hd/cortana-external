"""Two-stage strategy-family budgeting and candidate ranking."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Mapping, Sequence

from governance.authority import authority_weight_for_tier

DEFAULT_GROSS_EXPOSURE_BUDGET_FRACTION = 0.80


def build_strategy_budget_allocations(
    *,
    candidates: Sequence[Mapping[str, Any]],
    authority_artifact: Mapping[str, Any] | None = None,
    total_capital: float,
    gross_exposure_budget_fraction: float = DEFAULT_GROSS_EXPOSURE_BUDGET_FRACTION,
    generated_at: str | None = None,
) -> dict[str, Any]:
    families: dict[str, list[dict[str, Any]]] = {}
    authority_by_family = {
        str(item.get("strategy_family") or "").strip().lower(): dict(item)
        for item in (authority_artifact or {}).get("families") or []
        if isinstance(item, Mapping)
    }
    for candidate in candidates:
        if not isinstance(candidate, Mapping):
            continue
        family = str(candidate.get("strategy") or candidate.get("strategy_family") or "").strip().lower()
        if not family:
            continue
        families.setdefault(family, []).append(dict(candidate))

    gross_budget_amount = round(max(total_capital, 0.0) * max(gross_exposure_budget_fraction, 0.0), 2)
    weighted_scores: dict[str, float] = {}
    for family, rows in families.items():
        sorted_rows = sorted(
            rows,
            key=lambda row: (
                float(row.get("opportunity_score") or 0.0),
                float(row.get("trade_quality_score") or 0.0),
                float(row.get("effective_confidence") or 0.0),
            ),
            reverse=True,
        )
        family_signal = sum(float(row.get("opportunity_score") or 0.0) for row in sorted_rows[:3])
        authority_tier = str((authority_by_family.get(family) or {}).get("authority_tier") or "exploratory")
        weighted_scores[family] = max(family_signal, 1.0) * authority_weight_for_tier(authority_tier)

    total_weight = sum(weighted_scores.values()) or 1.0
    allocations: list[dict[str, Any]] = []
    for family, rows in sorted(families.items()):
        authority_row = authority_by_family.get(family) or {}
        default_authority_tier = "trusted" if not authority_artifact else "exploratory"
        authority_tier = str(authority_row.get("authority_tier") or default_authority_tier)
        autonomy_mode = str(
            authority_row.get("autonomy_mode")
            or ("supervised_live" if authority_tier == "trusted" else "paper" if authority_tier == "limited_trust" else "advisory")
        )
        family_weight = weighted_scores.get(family, 0.0) / total_weight
        raw_budget = round(gross_budget_amount * family_weight, 2)
        slot_cap = max(0, min(len(rows), round((family_weight * 5) + (1 if authority_tier != "demoted" else 0))))
        warnings: list[str] = []
        if not authority_artifact:
            slot_cap = len(rows)
        elif authority_tier == "demoted":
            raw_budget = min(raw_budget, round(total_capital * 0.05, 2))
            slot_cap = min(slot_cap, 1)
            warnings.append("demoted_authority_cap")
        elif authority_tier == "exploratory":
            raw_budget = min(raw_budget, round(total_capital * 0.15, 2))
            slot_cap = min(max(slot_cap, 1), 2)
            warnings.append("exploratory_budget_cap")
        elif authority_tier == "limited_trust":
            raw_budget = min(raw_budget, round(total_capital * 0.35, 2))
        else:
            slot_cap = max(slot_cap, 1)
        allocations.append(
            {
                "strategy_family": family,
                "generated_at": _normalize_timestamp(generated_at),
                "authority_tier": authority_tier,
                "autonomy_mode": autonomy_mode,
                "budget_type": "capital",
                "budget_amount": raw_budget,
                "gross_exposure_budget_fraction": round(gross_exposure_budget_fraction, 4),
                "candidate_slots": slot_cap,
                "authority_weight": round(authority_weight_for_tier(authority_tier), 4),
                "allocation_weight": round(family_weight, 4),
                "warnings": warnings,
            }
        )

    return {
        "artifact_family": "strategy_budget_allocations_v1",
        "schema_version": 1,
        "generated_at": _normalize_timestamp(generated_at),
        "total_capital": round(total_capital, 2),
        "gross_exposure_budget_amount": gross_budget_amount,
        "allocations": allocations,
    }


def strategy_budget_map(artifact: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(item.get("strategy_family") or "").strip().lower(): dict(item)
        for item in artifact.get("allocations") or []
        if isinstance(item, Mapping) and str(item.get("strategy_family") or "").strip()
    }


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
