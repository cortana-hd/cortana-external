"""Portfolio posture synthesis from allocation, risk, and authority artifacts."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping, Sequence

from lifecycle.trade_objects import deterministic_key
from lifecycle.ledgers import default_lifecycle_root
from portfolio.allocator import strategy_budget_map

DEFAULT_PORTFOLIO_POSTURE_PATH = default_lifecycle_root() / "portfolio_posture.json"


def build_portfolio_posture_artifact(
    *,
    snapshot_at: str,
    total_capital: float,
    open_positions: Sequence[Any],
    selected_candidates: Sequence[Mapping[str, Any]],
    budget_artifact: Mapping[str, Any] | None = None,
    risk_budget_state: Mapping[str, Any] | None = None,
    authority_artifact: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    budget_by_family = strategy_budget_map(budget_artifact or {})
    authority_by_family = {
        str(item.get("strategy_family") or "").strip().lower(): dict(item)
        for item in (authority_artifact or {}).get("families") or []
        if isinstance(item, Mapping)
    }
    open_capital = sum(float(getattr(item, "capital_allocated", 0.0) or 0.0) for item in open_positions)
    pending_capital = sum(float(item.get("capital_allocated", 0.0) or 0.0) for item in selected_candidates)
    gross_exposure = round((open_capital + pending_capital) / total_capital, 4) if total_capital > 0 else 0.0
    posture_state = str((risk_budget_state or {}).get("posture_state") or "risk_on")
    warnings = [str(item).strip() for item in (risk_budget_state or {}).get("warnings") or [] if str(item).strip()]

    strategy_allocations: list[dict[str, Any]] = []
    all_rows = [*list(open_positions), *[dict(item) for item in selected_candidates]]
    families = sorted(
        {
            str(getattr(item, "strategy", None) or item.get("strategy") or "").strip().lower()
            for item in all_rows
            if str(getattr(item, "strategy", None) or item.get("strategy") or "").strip()
        }
    )
    for family in families:
        family_open = sum(
            float(getattr(item, "capital_allocated", 0.0) or 0.0)
            for item in open_positions
            if str(getattr(item, "strategy", "") or "").strip().lower() == family
        )
        family_pending = sum(
            float(item.get("capital_allocated", 0.0) or 0.0)
            for item in selected_candidates
            if str(item.get("strategy") or "").strip().lower() == family
        )
        budget_row = budget_by_family.get(family) or {}
        authority_row = authority_by_family.get(family) or {}
        strategy_allocations.append(
            {
                "strategy_family": family,
                "open_capital": round(family_open, 2),
                "pending_capital": round(family_pending, 2),
                "budget_amount": float(budget_row.get("budget_amount", 0.0) or 0.0),
                "candidate_slots": int(budget_row.get("candidate_slots", 0) or 0),
                "authority_tier": authority_row.get("authority_tier") or budget_row.get("authority_tier"),
                "autonomy_mode": authority_row.get("autonomy_mode") or budget_row.get("autonomy_mode"),
            }
        )

    overlap_summary = _build_overlap_summary(open_positions, selected_candidates)
    if overlap_summary["sector_overlap_count"] > 0:
        warnings.append("sector_overlap_detected")
    if overlap_summary["theme_overlap_count"] > 0:
        warnings.append("theme_overlap_detected")

    artifact = {
        "artifact_family": "portfolio_posture_snapshots_v1",
        "schema_version": 1,
        "posture_id": deterministic_key("portfolio_posture", snapshot_at, posture_state, gross_exposure),
        "generated_at": _normalize_timestamp(snapshot_at),
        "known_at": _normalize_timestamp(snapshot_at),
        "posture_state": posture_state,
        "gross_exposure": gross_exposure,
        "net_exposure": gross_exposure,
        "drawdown_state": dict((risk_budget_state or {}).get("drawdown_state") or {}),
        "strategy_allocations": strategy_allocations,
        "overlap_summary": overlap_summary,
        "warnings": sorted(dict.fromkeys(warnings)),
        "summary": {
            "top_strategy_family": _top_strategy_family(strategy_allocations),
            "highest_autonomy_mode": _highest_autonomy_mode(strategy_allocations),
        },
    }
    return artifact


def save_portfolio_posture_artifact(
    artifact: Mapping[str, Any],
    *,
    path: Path | None = None,
) -> Path:
    target = (path or DEFAULT_PORTFOLIO_POSTURE_PATH).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(dict(artifact), indent=2) + "\n", encoding="utf-8")
    return target


def _build_overlap_summary(
    open_positions: Sequence[Any],
    selected_candidates: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    sector_counts: dict[str, int] = {}
    theme_counts: dict[str, int] = {}
    for item in [*list(open_positions), *[dict(candidate) for candidate in selected_candidates]]:
        if isinstance(item, Mapping):
            sector_value = item.get("sector")
            theme_value = item.get("theme")
        else:
            sector_value = getattr(item, "sector", None)
            theme_value = getattr(item, "theme", None)
        sector = str(sector_value or "").strip().lower()
        theme = str(theme_value or "").strip().lower()
        if sector:
            sector_counts[sector] = sector_counts.get(sector, 0) + 1
        if theme:
            theme_counts[theme] = theme_counts.get(theme, 0) + 1
    return {
        "sector_overlap_count": sum(1 for count in sector_counts.values() if count > 1),
        "theme_overlap_count": sum(1 for count in theme_counts.values() if count > 1),
        "sector_counts": sector_counts,
        "theme_counts": theme_counts,
    }


def _top_strategy_family(strategy_allocations: Sequence[Mapping[str, Any]]) -> str | None:
    ranked = sorted(
        strategy_allocations,
        key=lambda item: float(item.get("open_capital", 0.0) or 0.0) + float(item.get("pending_capital", 0.0) or 0.0),
        reverse=True,
    )
    return str(ranked[0].get("strategy_family") or "") or None if ranked else None


def _highest_autonomy_mode(strategy_allocations: Sequence[Mapping[str, Any]]) -> str:
    order = {"advisory": 0, "paper": 1, "supervised_live": 2, "guarded_live": 3}
    highest = "advisory"
    for row in strategy_allocations:
        mode = str(row.get("autonomy_mode") or "advisory")
        if order.get(mode, -1) > order.get(highest, -1):
            highest = mode
    return highest


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
