"""Paper-portfolio allocation and competition rules."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Mapping

from lifecycle.trade_objects import ClosedPosition, OpenPosition, deterministic_key
from portfolio.allocator import build_strategy_budget_allocations, strategy_budget_map
from portfolio.posture import build_portfolio_posture_artifact
from portfolio.risk_budget import build_risk_budget_state


DEFAULT_TOTAL_CAPITAL = 100_000.0
MAX_TOTAL_POSITIONS = 5
MAX_POSITIONS_PER_STRATEGY = 3
MAX_SINGLE_POSITION_FRACTION = 0.20
REENTRY_COOLDOWN_DAYS = 3.0


@dataclass(frozen=True)
class PaperPortfolioSnapshot:
    snapshot_id: str
    snapshot_at: str
    schema_version: str
    total_capital: float
    available_capital: float
    gross_exposure_pct: float
    pending_entry_count: int
    open_position_keys: list[str]
    blocked_candidates: list[dict[str, Any]]
    selected_candidates: list[dict[str, Any]]
    posture_state: str | None = None
    family_budgets: list[dict[str, Any]] = field(default_factory=list)
    risk_budget: dict[str, Any] = field(default_factory=dict)
    overlap_summary: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    posture_snapshot: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def select_entries(
    *,
    candidates: list[dict[str, Any]],
    open_positions: list[OpenPosition],
    closed_positions: list[ClosedPosition],
    snapshot_at: str,
    total_capital: float = DEFAULT_TOTAL_CAPITAL,
    authority_artifact: Mapping[str, Any] | None = None,
    portfolio_drawdown_pct: float | None = None,
) -> tuple[list[dict[str, Any]], PaperPortfolioSnapshot]:
    snapshot_at = _normalize_timestamp(snapshot_at)
    available_capital = max(total_capital - _capital_in_use(open_positions), 0.0)
    blocked: list[dict[str, Any]] = []
    selected: list[dict[str, Any]] = []
    open_symbols = {position.symbol for position in open_positions}
    pending_symbols: set[str] = set()
    per_strategy_counts = _strategy_counts(open_positions)
    budget_artifact = build_strategy_budget_allocations(
        candidates=candidates,
        authority_artifact=authority_artifact,
        total_capital=total_capital,
        generated_at=snapshot_at,
    ) if candidates else {"allocations": []}
    family_budgets = strategy_budget_map(budget_artifact)
    family_budget_remaining = {
        family: float(row.get("budget_amount", 0.0) or 0.0)
        for family, row in family_budgets.items()
    }
    family_slots_remaining = {
        family: int(row.get("candidate_slots", 0) or 0)
        for family, row in family_budgets.items()
    }
    risk_budget_state = build_risk_budget_state(
        total_capital=total_capital,
        open_positions=open_positions,
        portfolio_drawdown_pct=portfolio_drawdown_pct,
        generated_at=snapshot_at,
    )
    allowed_gross_fraction = float(
        ((risk_budget_state.get("gross_exposure") or {}).get("allowed_fraction") or 0.0)
    )
    sector_cap_fraction = float(
        ((risk_budget_state.get("concentration_caps") or {}).get("sector_cap_fraction") or 0.35)
    )
    theme_cap_fraction = float(
        ((risk_budget_state.get("concentration_caps") or {}).get("theme_cap_fraction") or 0.40)
    )
    sector_capital: dict[str, float] = {}
    theme_capital: dict[str, float] = {}

    ordered_candidates = sorted(
        candidates,
        key=lambda item: (
            float((family_budgets.get(str(item.get("strategy") or "").strip().lower()) or {}).get("allocation_weight") or 0.0),
            float(item.get("capital_fraction") or 0.0),
            float(item.get("opportunity_score") or 0.0),
            float(item.get("trade_quality_score") or 0.0),
            float(item.get("effective_confidence") or 0.0),
        ),
        reverse=True,
    )

    for candidate in ordered_candidates:
        symbol = str(candidate.get("symbol") or "").strip().upper()
        strategy = str(candidate.get("strategy") or "").strip().lower()
        family_budget = family_budgets.get(strategy) or {}
        capital_fraction = float(candidate.get("capital_fraction") or 0.0)
        allocation = round(min(total_capital * capital_fraction, total_capital * MAX_SINGLE_POSITION_FRACTION), 2)
        sector = str(candidate.get("sector") or "").strip().lower()
        theme = str(candidate.get("theme") or "").strip().lower()
        block_reason = None

        if not symbol:
            block_reason = "missing_symbol"
        elif str(risk_budget_state.get("posture_state") or "") == "paused":
            block_reason = "portfolio_drawdown_paused"
        elif symbol in open_symbols or symbol in pending_symbols:
            block_reason = "duplicate_symbol"
        elif _recently_closed(symbol=symbol, closed_positions=closed_positions, snapshot_at=snapshot_at):
            block_reason = "reentry_cooldown"
        elif family_budget and family_slots_remaining.get(strategy, 0) <= 0:
            block_reason = "family_candidate_slots_exhausted"
        elif family_budget and allocation > family_budget_remaining.get(strategy, 0.0):
            block_reason = "family_budget_exhausted"
        elif len(open_positions) + len(selected) >= MAX_TOTAL_POSITIONS:
            block_reason = "portfolio_capacity_reached"
        elif per_strategy_counts.get(strategy, 0) >= MAX_POSITIONS_PER_STRATEGY:
            block_reason = "strategy_cap_reached"
        elif allocation <= 0 or allocation > available_capital:
            block_reason = "insufficient_available_capital"
        elif (
            allowed_gross_fraction > 0
            and (_capital_in_use(open_positions) + sum(float(item.get("capital_allocated") or 0.0) for item in selected) + allocation)
            > (total_capital * allowed_gross_fraction)
        ):
            block_reason = "gross_exposure_cap_reached"
        elif sector and (sector_capital.get(sector, 0.0) + allocation) > (total_capital * sector_cap_fraction):
            block_reason = "sector_concentration_cap"
        elif theme and (theme_capital.get(theme, 0.0) + allocation) > (total_capital * theme_cap_fraction):
            block_reason = "theme_concentration_cap"

        if block_reason:
            blocked.append(
                {
                    "symbol": symbol,
                    "strategy": strategy,
                    "authority_tier": family_budget.get("authority_tier"),
                    "autonomy_mode": family_budget.get("autonomy_mode"),
                    "block_reason": block_reason,
                }
            )
            continue

        chosen = dict(candidate)
        chosen["capital_allocated"] = allocation
        chosen["authority_tier"] = family_budget.get("authority_tier")
        chosen["autonomy_mode"] = family_budget.get("autonomy_mode")
        chosen["strategy_budget_amount"] = family_budget.get("budget_amount")
        chosen["posture_state"] = risk_budget_state.get("posture_state")
        chosen["portfolio_fit_state"] = "selected"
        selected.append(chosen)
        pending_symbols.add(symbol)
        per_strategy_counts[strategy] = per_strategy_counts.get(strategy, 0) + 1
        available_capital = round(max(available_capital - allocation, 0.0), 2)
        if family_budget:
            family_budget_remaining[strategy] = round(max(family_budget_remaining.get(strategy, 0.0) - allocation, 0.0), 2)
            family_slots_remaining[strategy] = max(family_slots_remaining.get(strategy, 0) - 1, 0)
        if sector:
            sector_capital[sector] = round(sector_capital.get(sector, 0.0) + allocation, 2)
        if theme:
            theme_capital[theme] = round(theme_capital.get(theme, 0.0) + allocation, 2)

    gross_exposure = _capital_in_use(open_positions) + sum(float(item.get("capital_allocated") or 0.0) for item in selected)
    posture_snapshot = build_portfolio_posture_artifact(
        snapshot_at=snapshot_at,
        total_capital=total_capital,
        open_positions=open_positions,
        selected_candidates=selected,
        budget_artifact=budget_artifact,
        risk_budget_state=risk_budget_state,
        authority_artifact=authority_artifact,
    )
    snapshot = PaperPortfolioSnapshot(
        snapshot_id=deterministic_key("portfolio_snapshot", snapshot_at, len(selected), len(blocked)),
        snapshot_at=snapshot_at,
        schema_version="portfolio_snapshot.v1",
        total_capital=round(total_capital, 2),
        available_capital=round(available_capital, 2),
        gross_exposure_pct=round((gross_exposure / total_capital) * 100.0, 2) if total_capital > 0 else 0.0,
        pending_entry_count=len(selected),
        open_position_keys=[position.position_key for position in open_positions],
        blocked_candidates=blocked,
        selected_candidates=selected,
        posture_state=str(posture_snapshot.get("posture_state") or ""),
        family_budgets=list(budget_artifact.get("allocations") or []),
        risk_budget=dict(risk_budget_state),
        overlap_summary=dict(posture_snapshot.get("overlap_summary") or {}),
        warnings=list(posture_snapshot.get("warnings") or []),
        posture_snapshot=posture_snapshot,
    )
    return selected, snapshot


def build_portfolio_snapshot_artifact(snapshot: PaperPortfolioSnapshot) -> dict[str, Any]:
    return {
        "artifact_family": "portfolio_state_snapshot",
        "schema_version": 1,
        "generated_at": snapshot.snapshot_at,
        "snapshot": snapshot.to_dict(),
    }


def _capital_in_use(positions: list[OpenPosition]) -> float:
    return round(sum(float(position.capital_allocated or 0.0) for position in positions), 2)


def _strategy_counts(positions: list[OpenPosition]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for position in positions:
        counts[position.strategy] = counts.get(position.strategy, 0) + 1
    return counts


def _recently_closed(*, symbol: str, closed_positions: list[ClosedPosition], snapshot_at: str) -> bool:
    snapshot = datetime.fromisoformat(snapshot_at.replace("Z", "+00:00"))
    if snapshot.tzinfo is None:
        snapshot = snapshot.replace(tzinfo=timezone.utc)
    for position in reversed(closed_positions):
        if position.symbol != symbol:
            continue
        exited = datetime.fromisoformat(position.exited_at.replace("Z", "+00:00"))
        if exited.tzinfo is None:
            exited = exited.replace(tzinfo=timezone.utc)
        age_days = (snapshot.astimezone(timezone.utc) - exited.astimezone(timezone.utc)).total_seconds() / 86400.0
        return age_days < REENTRY_COOLDOWN_DAYS
    return False


def _normalize_timestamp(value: str) -> str:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()
