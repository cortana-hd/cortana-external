#!/usr/bin/env python3
"""Settle logged alert predictions and write a compact accuracy artifact."""

from __future__ import annotations

import argparse
import json

from evaluation.benchmark_models import build_benchmark_comparison_artifact
from evaluation.decision_review_metrics import build_decision_review_artifact
from evaluation.prediction_accuracy import build_prediction_accuracy_summary, settle_prediction_snapshots
from governance.challengers import (
    build_governance_operator_lines,
    build_governance_status_artifact,
    load_governance_decisions,
    save_governance_status_artifact,
)
from governance.registry import load_experiment_registry


def main() -> None:
    parser = argparse.ArgumentParser(description="Settle prediction snapshots and build an accuracy artifact")
    parser.add_argument("--json", action="store_true", help="Emit summary as JSON")
    args = parser.parse_args()

    settle_prediction_snapshots()
    summary = build_prediction_accuracy_summary()
    decision_review = build_decision_review_artifact()
    benchmark_summary = build_benchmark_comparison_artifact()
    governance_summary = _build_governance_summary()
    bundle = {
        "prediction_accuracy": summary,
        "decision_review": decision_review,
        "benchmark_comparisons": benchmark_summary,
        "governance": governance_summary,
    }

    if args.json:
        print(json.dumps(bundle, indent=2))
        return

    print("Prediction accuracy")
    print(f"Snapshots settled: {int(summary.get('snapshot_count', 0) or 0)}")
    print(f"Records logged: {int(summary.get('record_count', 0) or 0)}")
    settlement_status_counts = summary.get("settlement_status_counts") or {}
    if settlement_status_counts:
        print("Settlement states: " + _format_counts(settlement_status_counts))
    maturity_state_counts = summary.get("maturity_state_counts") or {}
    if maturity_state_counts:
        print("Maturity states: " + _format_counts(maturity_state_counts))
    horizon_status = summary.get("horizon_status") or {}
    if horizon_status:
        parts = []
        for horizon_key, status in sorted(horizon_status.items()):
            if not isinstance(status, dict):
                continue
            parts.append(
                f"{horizon_key}: matured {int(status.get('matured', 0) or 0)}"
                f" | pending {int(status.get('pending', 0) or 0)}"
                f" | incomplete {int(status.get('incomplete', 0) or 0)}"
            )
        if parts:
            print("Settlement coverage: " + " ; ".join(parts))
    validation_grade_counts = summary.get("validation_grade_counts") or {}
    if validation_grade_counts:
        grade_parts = []
        for key in (
            "signal_validation_grade",
            "entry_validation_grade",
            "execution_validation_grade",
            "trade_validation_grade",
        ):
            counts = validation_grade_counts.get(key)
            if not isinstance(counts, dict) or not counts:
                continue
            label = key.replace("_grade", "").replace("_", " ")
            grade_parts.append(f"{label}: {_format_counts(counts)}")
        if grade_parts:
            print("Validation grades: " + " ; ".join(grade_parts))
    rows = summary.get("summary") or []
    if not rows:
        print("No settled prediction samples yet.")
        return
    print("")
    print("By strategy/action")
    for row in rows:
        print(_format_summary_row(row, key_fields=("strategy", "action")))

    strategy_rows = summary.get("by_strategy") or []
    if strategy_rows:
        print("")
        print("By strategy")
        for row in strategy_rows:
            print(_format_summary_row(row, key_fields=("strategy",)))

    action_rows = summary.get("by_action") or []
    if action_rows:
        print("")
        print("By action")
        for row in action_rows:
            print(_format_summary_row(row, key_fields=("action",)))

    regime_rows = summary.get("by_regime") or []
    if regime_rows:
        print("")
        print("By regime")
        for row in regime_rows:
            print(_format_summary_row(row, key_fields=("strategy", "market_regime", "action")))

    confidence_rows = summary.get("by_confidence_bucket") or []
    if confidence_rows:
        print("")
        print("By confidence bucket")
        for row in confidence_rows:
            print(_format_summary_row(row, key_fields=("strategy", "confidence_bucket", "action")))

    rolling_summary = summary.get("rolling_summary") or {}
    if rolling_summary:
        print("")
        print("Rolling windows")
        for window_key in ("20", "50", "100"):
            payload = rolling_summary.get(window_key)
            if not isinstance(payload, dict):
                continue
            requested = int(payload.get("requested_window", 0) or 0)
            considered = int(payload.get("records_considered", 0) or 0)
            partial = bool(payload.get("is_partial_window"))
            qualifier = " (partial)" if partial else ""
            print(f"Latest {requested} samples{qualifier}: {considered} records")
            window_rows = payload.get("summary") or []
            if not window_rows:
                print("  no settled records")
                continue
            for row in window_rows:
                print("  " + _format_summary_row(row, key_fields=("strategy", "action")))

    opportunity_rows = (decision_review.get("opportunity_cost") or {}).get("by_action") or []
    if opportunity_rows:
        print("")
        print("Opportunity cost")
        for row in opportunity_rows:
            top_symbols = ", ".join(item.get("symbol", "") for item in (row.get("top_missed_symbols") or []) if item.get("symbol"))
            line = (
                f"{row.get('action', 'UNKNOWN')}: missed {int(row.get('missed_winner_count', 0) or 0)}"
                f"/{int(row.get('matured_count', 0) or 0)}"
            )
            missed_rate = row.get("missed_winner_rate")
            if isinstance(missed_rate, (int, float)):
                line += f" ({float(missed_rate):.0%})"
            avg_missed = row.get("avg_missed_return_pct")
            if isinstance(avg_missed, (int, float)):
                line += f" | avg missed return {float(avg_missed):+.2f}%"
            overblock_count = int(row.get("overblock_count", 0) or 0)
            if overblock_count:
                line += f" | overblocks {overblock_count}"
            if top_symbols:
                line += f" | top missed {top_symbols}"
            print(line)

    veto_rows = (decision_review.get("veto_effectiveness") or [])[:5]
    if veto_rows:
        print("")
        print("Veto effectiveness")
        for row in veto_rows:
            line = (
                f"{row.get('veto', 'unknown')}: preserved bad {int(row.get('preserved_bad_outcome_count', 0) or 0)}"
                f"/{int(row.get('matured_count', 0) or 0)}"
            )
            preserved_rate = row.get("preserved_bad_outcome_rate")
            if isinstance(preserved_rate, (int, float)):
                line += f" ({float(preserved_rate):.0%})"
            blocked_rate = row.get("blocked_winner_rate")
            if isinstance(blocked_rate, (int, float)):
                line += f" | blocked winners {float(blocked_rate):.0%}"
            avg_return = row.get("avg_return_pct")
            if isinstance(avg_return, (int, float)):
                line += f" | avg return {float(avg_return):+.2f}%"
            print(line)

    benchmark_rows = ((benchmark_summary.get("comparisons") or {}).get("by_strategy_action") or [])[:5]
    if benchmark_rows:
        print("")
        print("Benchmark comparisons")
        for row in benchmark_rows:
            metrics = row.get("metrics") or {}
            all_lift = row.get("lift_vs_all_predictions") or {}
            same_action_lift = row.get("lift_vs_same_action") or {}
            line = (
                f"{row.get('strategy', 'unknown')} {row.get('action', 'UNKNOWN')}: "
                f"n={int(metrics.get('matured_count', 0) or 0)} "
                f"mean={_format_optional_pct(metrics.get('mean_return'))} "
                f"hit={_format_optional_ratio(metrics.get('hit_rate'))}"
            )
            line += (
                f" | vs all mean { _format_optional_signed_lift(all_lift.get('mean_return_lift')) }"
                f" hit { _format_optional_signed_lift(all_lift.get('hit_rate_lift'), ratio=True) }"
            )
            if same_action_lift:
                line += (
                    f" | vs action mean { _format_optional_signed_lift(same_action_lift.get('mean_return_lift')) }"
                    f" hit { _format_optional_signed_lift(same_action_lift.get('hit_rate_lift'), ratio=True) }"
                )
            print(line)

    if governance_summary:
        print("")
        for line in build_governance_operator_lines(governance_summary):
            print(line)


def _format_summary_row(row: dict, *, key_fields: tuple[str, ...]) -> str:
    parts = [" ".join(str(row.get(field) or "unknown") for field in key_fields)]
    for horizon_key, metrics in row.items():
        if horizon_key in set(key_fields) or not isinstance(metrics, dict):
            continue
        decision_accuracy = float(metrics.get("decision_accuracy", 0.0) or 0.0)
        decision_label = str(metrics.get("decision_accuracy_label") or "decision_accuracy")
        drawdown = metrics.get("avg_max_drawdown_pct")
        runup = metrics.get("avg_max_runup_pct")
        segment = (
            f"{horizon_key}: n={int(metrics.get('samples', 0) or 0)} "
            f"avg={float(metrics.get('avg_return_pct', 0.0) or 0.0):+.2f}% "
            f"median={float(metrics.get('median_return_pct', 0.0) or 0.0):+.2f}% "
            f"hit={float(metrics.get('hit_rate', 0.0) or 0.0):.0%} "
            f"{decision_label}={decision_accuracy:.0%}"
        )
        extras = []
        if isinstance(drawdown, (int, float)):
            extras.append(f"avg drawdown {float(drawdown):+.2f}%")
        if isinstance(runup, (int, float)):
            extras.append(f"avg runup {float(runup):+.2f}%")
        if extras:
            segment += " | " + " | ".join(extras)
        parts.append(segment)
    return " | ".join(parts)


def _format_counts(counts: dict) -> str:
    parts = []
    for key, value in sorted(counts.items()):
        parts.append(f"{key} {int(value or 0)}")
    return " | ".join(parts)


def _format_optional_pct(value: object) -> str:
    if not isinstance(value, (int, float)):
        return "n/a"
    return f"{float(value):+.2f}%"


def _format_optional_ratio(value: object) -> str:
    if not isinstance(value, (int, float)):
        return "n/a"
    return f"{float(value):.0%}"


def _format_optional_signed_lift(value: object, *, ratio: bool = False) -> str:
    if not isinstance(value, (int, float)):
        return "n/a"
    if ratio:
        return f"{float(value):+.0%}"
    return f"{float(value):+.2f}%"


def _build_governance_summary() -> dict:
    try:
        registry = load_experiment_registry()
    except Exception:
        return {}
    decisions = load_governance_decisions()
    if not registry.get("experiments") and not decisions:
        return {}
    compare_only = True
    for entry in registry.get("experiments") or []:
        activation = entry.get("activation") or {}
        if bool(activation.get("enforced", False)):
            compare_only = False
            break
    artifact = build_governance_status_artifact(
        registry_payload=registry,
        decisions=decisions,
        compare_only=compare_only,
    )
    save_governance_status_artifact(artifact)
    return artifact


if __name__ == "__main__":
    main()
