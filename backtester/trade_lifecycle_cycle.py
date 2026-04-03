#!/usr/bin/env python3
"""Run deterministic paper-trade lifecycle updates from alert artifacts."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from data.risk_budget import build_position_size_recommendation
from lifecycle.entry_plan import build_entry_plan_from_signal
from lifecycle.execution_policy import build_execution_policy
from lifecycle.exit_engine import evaluate_exit_decision, update_position_mark_to_market
from lifecycle.ledgers import LifecycleLedgerStore
from lifecycle.paper_portfolio import build_portfolio_snapshot_artifact, select_entries
from lifecycle.position_review import build_position_review, build_position_review_artifact
from lifecycle.trade_objects import ClosedPosition, OpenPosition, deterministic_key


def run_cycle(
    *,
    alert_paths: list[Path],
    root: Path | None = None,
    generated_at: str | None = None,
    review_only: bool = False,
) -> dict[str, Any]:
    generated_at = _normalize_timestamp(generated_at or datetime.now(timezone.utc).isoformat())
    store = LifecycleLedgerStore(root=root)

    alerts = [_load_alert(path) for path in alert_paths if path.exists()]
    signal_map = _collect_signal_map(alerts)
    open_positions = store.load_open_positions()
    closed_positions = store.load_closed_positions()
    all_closed_positions = list(closed_positions)

    updated_open_positions: list[OpenPosition] = []
    new_closed_positions: list[ClosedPosition] = []
    reviews = []
    exit_decisions = []

    for position in open_positions:
        signal = signal_map.get(position.symbol)
        price = _signal_price(signal) if signal else position.entry_price
        decision = evaluate_exit_decision(
            position=position,
            reviewed_at=generated_at,
            current_price=price,
            market=_signal_market(signal, alerts),
            signal=signal,
        )
        marked = update_position_mark_to_market(
            position=position,
            current_price=price,
            current_state="exit_candidate" if decision.action == "EXIT" else "hold",
        )
        review_notes = _build_review_notes(signal=signal, decision=decision)
        review = build_position_review(
            position=marked,
            decision=decision,
            reviewed_at=generated_at,
            current_price=price,
            notes=review_notes,
        )
        reviews.append(review)
        exit_decisions.append(decision.to_dict())
        if decision.action == "EXIT":
            closed_position = ClosedPosition(
                id=deterministic_key("closed_position", position.position_key, generated_at),
                position_key=position.position_key,
                schema_version=position.schema_version,
                symbol=position.symbol,
                strategy=position.strategy,
                entered_at=position.entered_at,
                exited_at=generated_at,
                entry_price=position.entry_price,
                exit_price=decision.exit_price or marked.entry_price,
                exit_reason=decision.reason,
                realized_return_pct=review.realized_return_pct,
                hold_days=review.hold_days,
                position_review_ref=review.review_key,
                entry_plan_ref=position.entry_plan_ref,
                execution_policy_ref=position.execution_policy_ref,
            )
            new_closed_positions.append(closed_position)
            all_closed_positions.append(closed_position)
        else:
            updated_open_positions.append(marked)

    existing_symbols = {position.symbol for position in updated_open_positions}
    opened_positions: list[OpenPosition] = []
    execution_policies: list[dict[str, Any]] = []
    portfolio_snapshot = None
    if not review_only:
        candidate_entries: list[dict[str, Any]] = []
        for signal in _entry_candidates(alerts):
            symbol = str(signal.get("symbol") or "").strip().upper()
            if not symbol or symbol in existing_symbols:
                continue
            entry_plan = dict(signal.get("entry_plan") or {})
            if not entry_plan:
                maybe_plan = build_entry_plan_from_signal(
                    strategy=str(signal.get("strategy") or ""),
                    signal=signal,
                    market=_signal_market(signal, alerts),
                    overlays=_signal_overlays(signal, alerts),
                    generated_at=generated_at,
                )
                if maybe_plan is None:
                    continue
                entry_plan = maybe_plan.to_dict()
            if not bool(entry_plan.get("executable")):
                continue
            policy_payload = signal.get("execution_policy")
            if isinstance(policy_payload, dict):
                execution_policy = dict(policy_payload)
            else:
                policy = build_execution_policy(
                    strategy=str(signal.get("strategy") or ""),
                    signal=signal,
                    entry_plan=entry_plan,
                    overlays=_signal_overlays(signal, alerts),
                    generated_at=generated_at,
                )
                execution_policy = policy.to_dict()
            execution_policies.append(execution_policy)
            entry_price = _entry_fill_price(signal=signal, entry_plan=entry_plan)
            if entry_price is None:
                continue
            size_guidance = build_position_size_recommendation(
                signal=signal,
                risk_overlay=_signal_overlays(signal, alerts).get("risk"),
                execution_policy=execution_policy,
                data_quality_state=str(entry_plan.get("data_quality_state") or signal.get("data_quality_state") or "ok"),
            ).to_dict()
            candidate_entries.append(
                {
                    "symbol": symbol,
                    "strategy": str(signal.get("strategy") or "").strip().lower(),
                    "trade_quality_score": float(signal.get("trade_quality_score") or 0.0),
                    "effective_confidence": float(signal.get("effective_confidence") or 0.0),
                    "entry_price": entry_price,
                    "entry_plan": entry_plan,
                    "execution_policy": execution_policy,
                    "size_guidance": size_guidance,
                    "capital_fraction": float(size_guidance.get("capital_fraction") or 0.0),
                    "size_tier": str(size_guidance.get("size_tier") or "no_size"),
                    "entry_plan_ref": str(signal.get("entry_plan_ref") or entry_plan.get("plan_key") or "") or None,
                    "execution_policy_ref": str(signal.get("execution_policy_ref") or execution_policy.get("policy_key") or "") or None,
                }
            )

        selected_candidates, portfolio_snapshot = select_entries(
            candidates=candidate_entries,
            open_positions=updated_open_positions,
            closed_positions=all_closed_positions,
            snapshot_at=generated_at,
        )
        for candidate in selected_candidates:
            symbol = str(candidate.get("symbol") or "").strip().upper()
            position_key = deterministic_key(
                "position",
                str(candidate.get("strategy") or ""),
                symbol,
                str(candidate.get("entry_plan_ref") or ""),
            )
            opened = OpenPosition(
                id=deterministic_key("open_position", position_key, generated_at),
                position_key=position_key,
                schema_version=str((candidate.get("entry_plan") or {}).get("schema_version") or "lifecycle.v1"),
                symbol=symbol,
                strategy=str(candidate.get("strategy") or "").strip().lower(),
                entered_at=generated_at,
                entry_price=float(candidate.get("entry_price")),
                size_tier=str(candidate.get("size_tier") or "no_size"),
                capital_allocated=float(candidate.get("capital_allocated") or 0.0),
                entry_plan_ref=str(candidate.get("entry_plan_ref") or "") or None,
                execution_policy_ref=str(candidate.get("execution_policy_ref") or "") or None,
                stop_price=_optional_float((candidate.get("entry_plan") or {}).get("initial_stop_price")),
                target_price_1=_optional_float((candidate.get("entry_plan") or {}).get("first_target_price")),
                target_price_2=_optional_float((candidate.get("entry_plan") or {}).get("stretch_target_price")),
                current_state="open",
                portfolio_snapshot_ref=portfolio_snapshot.snapshot_id if portfolio_snapshot else None,
            )
            updated_open_positions.append(opened)
            opened_positions.append(opened)
            existing_symbols.add(symbol)

    store.write_open_positions(updated_open_positions)
    store.write_closed_positions(all_closed_positions)
    store.write_artifact(
        "position_reviews.json",
        build_position_review_artifact(reviews=reviews, generated_at=generated_at),
    )
    store.write_artifact(
        "execution_policies.json",
        {
            "artifact_family": "execution_policy_snapshots",
            "schema_version": 1,
            "generated_at": generated_at,
            "policies": execution_policies,
        },
    )
    if portfolio_snapshot is not None:
        store.write_artifact(
            "portfolio_snapshot.json",
            build_portfolio_snapshot_artifact(portfolio_snapshot),
        )

    summary = {
        "artifact_family": "trade_lifecycle_cycle",
        "schema_version": 1,
        "generated_at": generated_at,
        "summary": {
            "review_only": review_only,
            "alerts_processed": len(alerts),
            "opened_count": len(opened_positions),
            "closed_count": len(new_closed_positions),
            "open_count": len(updated_open_positions),
            "closed_total_count": len(all_closed_positions),
            "portfolio_blocked_count": len(portfolio_snapshot.blocked_candidates) if portfolio_snapshot is not None else 0,
        },
        "opened_positions": [position.to_dict() for position in opened_positions],
        "closed_positions": [position.to_dict() for position in new_closed_positions],
        "open_positions": [position.to_dict() for position in updated_open_positions],
        "reviews": [review.to_dict() for review in reviews],
        "exit_decisions": exit_decisions,
        "portfolio_snapshot": portfolio_snapshot.to_dict() if portfolio_snapshot is not None else None,
    }
    store.write_artifact("cycle_summary.json", summary)
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the paper trade lifecycle cycle")
    parser.add_argument("--alert-json", dest="alert_paths", action="append", default=[])
    parser.add_argument("--root", default=None)
    parser.add_argument("--generated-at", default=None)
    parser.add_argument("--review-only", action="store_true")
    parser.add_argument("--json", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    summary = run_cycle(
        alert_paths=[Path(path).expanduser() for path in args.alert_paths],
        root=Path(args.root).expanduser() if args.root else None,
        generated_at=args.generated_at,
        review_only=bool(args.review_only),
    )
    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        print(
            "Trade lifecycle cycle complete | "
            f"opened {summary['summary']['opened_count']} | "
            f"closed {summary['summary']['closed_count']} | "
            f"open {summary['summary']['open_count']}"
        )
    return 0


def _load_alert(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Alert payload must be a dict: {path}")
    return payload


def _collect_signal_map(alerts: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for payload in alerts:
        strategy = str(payload.get("strategy") or "").strip().lower()
        for signal in payload.get("signals", []) or []:
            if not isinstance(signal, dict):
                continue
            symbol = str(signal.get("symbol") or "").strip().upper()
            if not symbol:
                continue
            copied = dict(signal)
            copied["strategy"] = strategy
            out[symbol] = copied
    return out


def _entry_candidates(alerts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for payload in alerts:
        strategy = str(payload.get("strategy") or "").strip().lower()
        for signal in payload.get("signals", []) or []:
            if not isinstance(signal, dict):
                continue
            if str(signal.get("action") or "").strip().upper() != "BUY":
                continue
            copied = dict(signal)
            copied["strategy"] = strategy
            candidates.append(copied)
    candidates.sort(
        key=lambda item: (
            float(item.get("trade_quality_score") or 0.0),
            float(item.get("effective_confidence") or 0.0),
        ),
        reverse=True,
    )
    return candidates


def _signal_market(signal: dict[str, Any] | None, alerts: list[dict[str, Any]]) -> dict[str, Any]:
    symbol = str((signal or {}).get("symbol") or "").strip().upper()
    for payload in alerts:
        if not isinstance(payload, dict):
            continue
        for item in payload.get("signals", []) or []:
            if str(item.get("symbol") or "").strip().upper() == symbol:
                market = payload.get("market")
                if isinstance(market, dict):
                    return market
    return {}


def _signal_overlays(signal: dict[str, Any] | None, alerts: list[dict[str, Any]]) -> dict[str, Any]:
    symbol = str((signal or {}).get("symbol") or "").strip().upper()
    for payload in alerts:
        if not isinstance(payload, dict):
            continue
        for item in payload.get("signals", []) or []:
            if str(item.get("symbol") or "").strip().upper() == symbol:
                overlays = payload.get("overlays")
                if isinstance(overlays, dict):
                    return overlays
    return {}


def _signal_price(signal: dict[str, Any] | None) -> float | None:
    if not isinstance(signal, dict):
        return None
    rec = signal.get("rec") if isinstance(signal.get("rec"), dict) else {}
    for value in (signal.get("price"), rec.get("entry"), rec.get("price")):
        parsed = _optional_float(value)
        if parsed is not None:
            return parsed
    return None


def _entry_fill_price(*, signal: dict[str, Any], entry_plan: dict[str, Any]) -> float | None:
    price = _signal_price(signal)
    ideal_min = _optional_float(entry_plan.get("entry_price_ideal_min"))
    ideal_max = _optional_float(entry_plan.get("entry_price_ideal_max"))
    if price is None and ideal_min is not None and ideal_max is not None:
        return round((ideal_min + ideal_max) / 2.0, 4)
    if price is None:
        return ideal_max or ideal_min
    if ideal_min is not None and price < ideal_min:
        return ideal_min
    if ideal_max is not None and price > ideal_max:
        return ideal_max
    return round(price, 4)


def _build_review_notes(*, signal: dict[str, Any] | None, decision: Any) -> list[str]:
    notes: list[str] = []
    if isinstance(signal, dict):
        action = str(signal.get("action") or "").strip().upper()
        if action:
            notes.append(f"latest signal action {action}")
        reason = str(signal.get("reason") or "").strip()
        if reason:
            notes.append(reason)
    if getattr(decision, "reason", ""):
        notes.append(f"decision reason {decision.reason}")
    return notes


def _normalize_timestamp(value: str) -> str:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def _optional_float(value: object) -> float | None:
    try:
        if value is None or value == "":
            return None
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric <= 0 or numeric != numeric:
        return None
    return round(numeric, 4)


if __name__ == "__main__":
    raise SystemExit(main())
