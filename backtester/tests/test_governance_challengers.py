from governance.challengers import (
    apply_governance_decision,
    build_governance_status_artifact,
)
from governance.registry import build_governance_decision_artifact, build_registry_entry


def _registry_payload() -> dict:
    return {
        "schema_version": 1,
        "generated_at": None,
        "experiments": [
            build_registry_entry(
                experiment_key="dip_buyer_incumbent",
                artifact_family="strategy",
                owner="tests",
                status="incumbent",
                activation={"mode": "enforced", "enforced": True, "eligible_for_live_authority": True},
            ),
            build_registry_entry(
                experiment_key="dip_buyer_challenger",
                artifact_family="strategy",
                owner="tests",
                status="shadow",
            ),
        ],
    }


def test_compare_only_promotion_keeps_candidate_as_challenger():
    registry = apply_governance_decision(
        registry_payload=_registry_payload(),
        decision_artifact=build_governance_decision_artifact(
            experiment_key="dip_buyer_challenger",
            decision_type="promotion",
            decision_result="pass",
            gate_results={"required_gate_failures": []},
            reasons=[],
        ),
        compare_only=True,
    )
    statuses = {item["experiment_key"]: item["status"] for item in registry["experiments"]}
    assert statuses["dip_buyer_challenger"] == "challenger"
    assert statuses["dip_buyer_incumbent"] == "incumbent"


def test_enforced_promotion_replaces_prior_incumbent_audit_safely():
    registry = apply_governance_decision(
        registry_payload=_registry_payload(),
        decision_artifact=build_governance_decision_artifact(
            experiment_key="dip_buyer_challenger",
            decision_type="promotion",
            decision_result="pass",
            gate_results={"required_gate_failures": []},
            reasons=[],
        ),
        compare_only=False,
    )
    statuses = {item["experiment_key"]: item["status"] for item in registry["experiments"]}
    assert statuses["dip_buyer_challenger"] == "incumbent"
    assert statuses["dip_buyer_incumbent"] == "challenger"


def test_demoted_or_retired_logic_cannot_remain_active_incumbent():
    updated = apply_governance_decision(
        registry_payload=_registry_payload(),
        decision_artifact=build_governance_decision_artifact(
            experiment_key="dip_buyer_incumbent",
            decision_type="demotion",
            decision_result="pass",
            gate_results={"demotion_triggers": ["recent_hit_rate_pass"]},
            reasons=["recent hit rate too low"],
        ),
        compare_only=True,
    )
    summary = build_governance_status_artifact(
        registry_payload=updated,
        decisions=[
            build_governance_decision_artifact(
                experiment_key="dip_buyer_incumbent",
                decision_type="demotion",
                decision_result="pass",
                gate_results={"demotion_triggers": ["recent_hit_rate_pass"]},
                reasons=["recent hit rate too low"],
            )
        ],
        compare_only=True,
    )
    incumbents = [item["experiment_key"] for item in summary["active_incumbents"]]
    assert "dip_buyer_incumbent" not in incumbents
    assert summary["activation_hooks"]["mode"] == "compare_only"
    assert summary["recent_authority_changes"][0]["experiment_key"] == "dip_buyer_incumbent"
