"""Promotion and demotion gate evaluators for governed experiments."""

from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
from typing import Any, Mapping

from governance.registry import (
    GovernanceRegistryError,
    build_governance_decision_artifact,
    load_demotion_rules,
    load_promotion_gates,
)
from governance.authority import synthesize_strategy_authority_row
from governance.autonomy_tiers import evaluate_autonomy_transition


def evaluate_promotion_decision(
    *,
    experiment_key: str,
    registry_entry: Mapping[str, Any],
    benchmark_artifact: Mapping[str, Any],
    walk_forward_artifact: Mapping[str, Any],
    leakage_artifact: Mapping[str, Any],
    promotion_gates: Mapping[str, Any] | None = None,
    generated_at: str | None = None,
) -> dict[str, Any]:
    config = dict((promotion_gates or load_promotion_gates()).get("promotion_gates") or {})
    gate_results = {
        "sample_depth_pass": _sample_depth_gate(walk_forward_artifact, config),
        "walk_forward_pass": _walk_forward_gate(walk_forward_artifact, config),
        "regime_coverage_pass": _regime_coverage_gate(walk_forward_artifact, config),
        "worse_fill_pass": _worse_fill_gate(walk_forward_artifact, config),
        "benchmark_pass": _benchmark_gate(benchmark_artifact, config),
        "leakage_pass": _leakage_gate(leakage_artifact),
        "degraded_input_pass": _degraded_input_gate(
            benchmark_artifact=benchmark_artifact,
            walk_forward_artifact=walk_forward_artifact,
            leakage_artifact=leakage_artifact,
        ),
    }
    blocking = [name for name, payload in gate_results.items() if not bool(payload.get("passed", False))]
    reasons = [str(gate_results[name].get("reason") or name).strip() for name in blocking]
    return build_governance_decision_artifact(
        experiment_key=experiment_key,
        decision_type="promotion",
        decision_result="pass" if not blocking else "fail",
        gate_results={
            **deepcopy(gate_results),
            "required_gate_failures": blocking,
            "compare_only_mode": bool(config.get("compare_only_mode", True)),
        },
        reasons=reasons,
        effective_from=_normalize_timestamp(generated_at or datetime.now(UTC).isoformat()) if not blocking else None,
        lineage={
            "registry_status": str(registry_entry.get("status") or ""),
            "artifact_family": str(registry_entry.get("artifact_family") or ""),
            "benchmark_family": str(benchmark_artifact.get("artifact_family") or ""),
            "walk_forward_family": str(walk_forward_artifact.get("artifact_family") or ""),
            "leakage_family": str(leakage_artifact.get("artifact_family") or ""),
        },
        generated_at=generated_at,
    )


def evaluate_demotion_decision(
    *,
    experiment_key: str,
    registry_entry: Mapping[str, Any],
    recent_metrics: Mapping[str, Any],
    leakage_artifact: Mapping[str, Any] | None = None,
    demotion_rules: Mapping[str, Any] | None = None,
    generated_at: str | None = None,
) -> dict[str, Any]:
    config = dict((demotion_rules or load_demotion_rules()).get("demotion_rules") or {})
    gate_results = {
        "recent_hit_rate_pass": _recent_hit_rate_gate(recent_metrics, config),
        "recent_mean_return_pass": _recent_mean_return_gate(recent_metrics, config),
        "review_streak_pass": _review_streak_gate(recent_metrics, config),
        "leakage_pass": _demotion_leakage_gate(leakage_artifact, config),
        "governance_block_pass": _governance_block_gate(recent_metrics, config),
    }
    triggers = [name for name, payload in gate_results.items() if not bool(payload.get("passed", False))]
    reasons = [str(gate_results[name].get("reason") or name).strip() for name in triggers]
    return build_governance_decision_artifact(
        experiment_key=experiment_key,
        decision_type="demotion",
        decision_result="pass" if triggers else "advisory",
        gate_results={
            **deepcopy(gate_results),
            "demotion_triggers": triggers,
        },
        reasons=reasons,
        effective_from=_normalize_timestamp(generated_at or datetime.now(UTC).isoformat()) if triggers else None,
        lineage={
            "registry_status": str(registry_entry.get("status") or ""),
            "artifact_family": str(registry_entry.get("artifact_family") or ""),
        },
        generated_at=generated_at,
    )


def evaluate_strategy_authority(
    *,
    strategy_row: Mapping[str, Any],
    operator_rationale: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    return synthesize_strategy_authority_row(
        strategy_row,
        operator_rationale=operator_rationale,
    )


def evaluate_stronger_autonomy_gate(
    *,
    authority_artifact: Mapping[str, Any],
    review_window_artifact: Mapping[str, Any] | None = None,
    requested_mode: str = "guarded_live",
    generated_at: str | None = None,
) -> dict[str, Any]:
    return evaluate_autonomy_transition(
        authority_artifact=authority_artifact,
        review_window_artifact=review_window_artifact,
        requested_mode=requested_mode,
        generated_at=generated_at,
    )


def _sample_depth_gate(walk_forward_artifact: Mapping[str, Any], config: Mapping[str, Any]) -> dict[str, Any]:
    minimum_samples = int(config.get("minimum_samples", 0) or 0)
    matured = sum(
        int(((window.get("out_of_sample") or {}).get("matured_count") or 0))
        for window in (walk_forward_artifact.get("window_results") or [])
        if isinstance(window, Mapping)
    )
    passed = matured >= minimum_samples
    return {
        "passed": passed,
        "observed": matured,
        "required": minimum_samples,
        "reason": f"only {matured} matured out-of-sample samples; requires {minimum_samples}" if not passed else "sample depth OK",
    }


def _walk_forward_gate(walk_forward_artifact: Mapping[str, Any], config: Mapping[str, Any]) -> dict[str, Any]:
    summary = dict(walk_forward_artifact.get("pass_fail_summary") or {})
    minimum_windows = int(config.get("minimum_walk_forward_windows", 0) or 0)
    window_count = int(summary.get("window_count", 0) or 0)
    passed = bool(summary.get("passed", False)) and window_count >= minimum_windows
    reasons = list(summary.get("reasons") or [])
    if window_count < minimum_windows:
        reasons.append(f"needs at least {minimum_windows} walk-forward windows")
    return {
        "passed": passed,
        "observed": window_count,
        "required": minimum_windows,
        "reason": "; ".join(dict.fromkeys(str(reason) for reason in reasons)) if reasons else "walk-forward OK",
    }


def _regime_coverage_gate(walk_forward_artifact: Mapping[str, Any], config: Mapping[str, Any]) -> dict[str, Any]:
    minimum_segments = int(config.get("minimum_regime_segments", 0) or 0)
    observed = int(((walk_forward_artifact.get("regime_segment_summary") or {}).get("regime_count") or 0))
    passed = observed >= minimum_segments
    return {
        "passed": passed,
        "observed": observed,
        "required": minimum_segments,
        "reason": f"only {observed} regime segments observed; requires {minimum_segments}" if not passed else "regime coverage OK",
    }


def _worse_fill_gate(walk_forward_artifact: Mapping[str, Any], config: Mapping[str, Any]) -> dict[str, Any]:
    maximum_delta = float(config.get("maximum_worse_fill_drawdown_delta_pct", 0.0) or 0.0)
    observed = float(((walk_forward_artifact.get("stress_test_summary") or {}).get("worse_fill_drawdown_delta_pct") or 0.0))
    passed = observed <= maximum_delta
    return {
        "passed": passed,
        "observed": observed,
        "required": maximum_delta,
        "reason": (
            f"worse-fill drawdown delta {observed:.3f}% exceeds {maximum_delta:.3f}%"
            if not passed
            else "worse-fill sensitivity OK"
        ),
    }


def _benchmark_gate(benchmark_artifact: Mapping[str, Any], config: Mapping[str, Any]) -> dict[str, Any]:
    ladders = list(benchmark_artifact.get("benchmark_ladder") or [])
    minimum_lift = float(config.get("minimum_mean_return_lift_pct", 0.0) or 0.0)
    minimum_hit_rate = float(config.get("minimum_hit_rate", 0.0) or 0.0)
    failing_ladders: list[str] = []
    observed_rows = 0
    for ladder in ladders:
        if not isinstance(ladder, Mapping):
            continue
        rows = list(ladder.get("rows") or [])
        observed_rows += len(rows)
        row_pass = False
        for row in rows:
            if not isinstance(row, Mapping):
                continue
            metrics = row.get("metrics") or {}
            lift = row.get("lift_vs_same_action") or row.get("lift_vs_all_predictions") or {}
            hit_rate = metrics.get("hit_rate")
            mean_lift = lift.get("mean_return_lift")
            if isinstance(hit_rate, (int, float)) and isinstance(mean_lift, (int, float)):
                if float(hit_rate) >= minimum_hit_rate and float(mean_lift) >= minimum_lift:
                    row_pass = True
                    break
        if not row_pass:
            failing_ladders.append(str(ladder.get("benchmark_name") or ladder.get("source_key") or "unknown"))
    passed = observed_rows > 0 and not failing_ladders
    return {
        "passed": passed,
        "observed": observed_rows,
        "required": len(ladders),
        "reason": (
            f"benchmark ladders failed: {', '.join(failing_ladders)}"
            if failing_ladders or observed_rows <= 0
            else "benchmark ladder OK"
        ),
    }


def _leakage_gate(leakage_artifact: Mapping[str, Any]) -> dict[str, Any]:
    summary = dict(leakage_artifact.get("pass_fail_summary") or {})
    passed = bool(summary.get("passed", False))
    blockers = list(summary.get("blocking_findings") or [])
    return {
        "passed": passed,
        "reason": f"leakage blockers: {', '.join(str(item) for item in blockers)}" if blockers else "point-in-time audit OK",
    }


def _degraded_input_gate(
    *,
    benchmark_artifact: Mapping[str, Any],
    walk_forward_artifact: Mapping[str, Any],
    leakage_artifact: Mapping[str, Any],
) -> dict[str, Any]:
    degraded = []
    for label, payload in (
        ("benchmark", benchmark_artifact),
        ("walk_forward", walk_forward_artifact),
        ("leakage", leakage_artifact),
    ):
        if _artifact_is_degraded(payload):
            degraded.append(label)
    return {
        "passed": not degraded,
        "reason": f"degraded governance inputs: {', '.join(degraded)}" if degraded else "input quality OK",
    }


def _recent_hit_rate_gate(recent_metrics: Mapping[str, Any], config: Mapping[str, Any]) -> dict[str, Any]:
    threshold = float(config.get("minimum_recent_hit_rate", 0.0) or 0.0)
    observed = float(recent_metrics.get("recent_hit_rate", 1.0) or 0.0)
    passed = observed >= threshold
    return {
        "passed": passed,
        "observed": observed,
        "required": threshold,
        "reason": f"recent hit rate {observed:.2%} below {threshold:.2%}" if not passed else "recent hit rate OK",
    }


def _recent_mean_return_gate(recent_metrics: Mapping[str, Any], config: Mapping[str, Any]) -> dict[str, Any]:
    threshold = float(config.get("maximum_recent_mean_return_pct", 0.0) or 0.0)
    observed = float(recent_metrics.get("recent_mean_return_pct", 0.0) or 0.0)
    passed = observed >= threshold
    return {
        "passed": passed,
        "observed": observed,
        "required": threshold,
        "reason": f"recent mean return {observed:+.2f}% below {threshold:+.2f}%" if not passed else "recent mean return OK",
    }


def _review_streak_gate(recent_metrics: Mapping[str, Any], config: Mapping[str, Any]) -> dict[str, Any]:
    maximum = int(config.get("maximum_consecutive_failed_reviews", 0) or 0)
    observed = int(recent_metrics.get("consecutive_failed_reviews", 0) or 0)
    passed = observed <= maximum
    return {
        "passed": passed,
        "observed": observed,
        "required": maximum,
        "reason": f"consecutive failed reviews {observed} exceeds {maximum}" if not passed else "review streak OK",
    }


def _demotion_leakage_gate(leakage_artifact: Mapping[str, Any] | None, config: Mapping[str, Any]) -> dict[str, Any]:
    maximum_failures = int(config.get("maximum_leakage_failures", 0) or 0)
    blocking_findings = list(((leakage_artifact or {}).get("pass_fail_summary") or {}).get("blocking_findings") or [])
    observed = len(blocking_findings)
    passed = observed <= maximum_failures
    return {
        "passed": passed,
        "observed": observed,
        "required": maximum_failures,
        "reason": f"leakage failures {observed} exceed {maximum_failures}" if not passed else "leakage threshold OK",
    }


def _governance_block_gate(recent_metrics: Mapping[str, Any], config: Mapping[str, Any]) -> dict[str, Any]:
    demote_on_block = bool(config.get("demote_on_governance_block", False))
    governance_blocked = bool(recent_metrics.get("governance_blocked", False))
    passed = not (demote_on_block and governance_blocked)
    return {
        "passed": passed,
        "reason": "explicit governance block triggered" if not passed else "no governance block",
    }


def _artifact_is_degraded(payload: Mapping[str, Any]) -> bool:
    status = str(payload.get("status") or "").strip().lower()
    if status == "degraded":
        return True
    if payload.get("degraded_reason"):
        return True
    summary = payload.get("pass_fail_summary") or {}
    if isinstance(summary, Mapping) and bool(summary.get("degraded_input", False)):
        return True
    return False


def _normalize_timestamp(value: object) -> str:
    text = str(value or "").strip()
    if not text:
        raise GovernanceRegistryError("timestamp is required")
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).isoformat()
