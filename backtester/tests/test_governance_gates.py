from governance.gates import evaluate_demotion_decision, evaluate_promotion_decision
from governance.registry import build_registry_entry


def _registry_entry() -> dict:
    return build_registry_entry(
        experiment_key="dip_buyer_v2",
        artifact_family="strategy",
        owner="tests",
        status="shadow",
    )


def _benchmark_artifact(*, mean_lift: float = 0.4, hit_rate: float = 0.6, status: str = "ok") -> dict:
    return {
        "artifact_family": "benchmark_ladder_summary",
        "status": status,
        "benchmark_ladder": [
            {
                "benchmark_name": "same_action",
                "rows": [
                    {
                        "strategy": "dip_buyer",
                        "action": "BUY",
                        "metrics": {"matured_count": 40, "hit_rate": hit_rate},
                        "lift_vs_same_action": {"mean_return_lift": mean_lift},
                    }
                ],
            }
        ],
    }


def _walk_forward_artifact(
    *,
    window_count: int = 3,
    matured_count: int = 15,
    regime_count: int = 2,
    fragile_parameter_count: int = 0,
    worse_fill_delta: float = 1.0,
    status: str = "ok",
) -> dict:
    return {
        "artifact_family": "walk_forward_summary",
        "status": status,
        "window_results": [
            {"out_of_sample": {"matured_count": matured_count, "mean_return_pct": 0.5}}
            for _ in range(window_count)
        ],
        "regime_segment_summary": {"regime_count": regime_count},
        "parameter_stability_summary": {"fragile_parameter_count": fragile_parameter_count},
        "stress_test_summary": {"worse_fill_drawdown_delta_pct": worse_fill_delta},
        "pass_fail_summary": {
            "passed": fragile_parameter_count == 0 and window_count >= 3 and regime_count >= 2,
            "window_count": window_count,
            "reasons": [] if fragile_parameter_count == 0 and regime_count >= 2 else ["fragile"],
        },
    }


def _leakage_artifact(*, passed: bool = True, blockers: list[str] | None = None, status: str = "ok") -> dict:
    return {
        "artifact_family": "point_in_time_audit_summary",
        "status": status,
        "pass_fail_summary": {
            "passed": passed,
            "blocking_findings": list(blockers or []),
        },
    }


def test_promotion_requires_all_declared_gates():
    decision = evaluate_promotion_decision(
        experiment_key="dip_buyer_v2",
        registry_entry=_registry_entry(),
        benchmark_artifact=_benchmark_artifact(mean_lift=-0.1),
        walk_forward_artifact=_walk_forward_artifact(),
        leakage_artifact=_leakage_artifact(),
    )
    assert decision["decision_type"] == "promotion"
    assert decision["decision_result"] == "fail"
    assert "benchmark_pass" in decision["gate_results"]["required_gate_failures"]


def test_promotion_blocks_tiny_sample_single_regime_and_degraded_inputs():
    decision = evaluate_promotion_decision(
        experiment_key="dip_buyer_v2",
        registry_entry=_registry_entry(),
        benchmark_artifact=_benchmark_artifact(status="degraded"),
        walk_forward_artifact=_walk_forward_artifact(window_count=1, matured_count=5, regime_count=1),
        leakage_artifact=_leakage_artifact(),
    )
    failures = set(decision["gate_results"]["required_gate_failures"])
    assert decision["decision_result"] == "fail"
    assert {"sample_depth_pass", "walk_forward_pass", "regime_coverage_pass", "degraded_input_pass"} <= failures


def test_demotion_rules_can_trigger_without_deleting_lineage():
    entry = build_registry_entry(
        experiment_key="dip_buyer_incumbent",
        artifact_family="strategy",
        owner="tests",
        status="incumbent",
    )
    decision = evaluate_demotion_decision(
        experiment_key="dip_buyer_incumbent",
        registry_entry=entry,
        recent_metrics={
            "recent_hit_rate": 0.3,
            "recent_mean_return_pct": -0.6,
            "consecutive_failed_reviews": 3,
        },
        leakage_artifact=_leakage_artifact(),
    )
    assert decision["decision_type"] == "demotion"
    assert decision["decision_result"] == "pass"
    assert decision["lineage"]["registry_status"] == "incumbent"
