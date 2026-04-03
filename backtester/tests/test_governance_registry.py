from __future__ import annotations

import json

import pytest

from governance.registry import (
    GovernanceRegistryError,
    build_governance_decision_artifact,
    build_registry_entry,
    load_demotion_rules,
    load_experiment_registry,
    load_experiment_registry_from_payload,
    load_promotion_gates,
    save_experiment_registry,
    transition_registry_entry,
)


def test_registry_entry_and_transition_are_deterministic():
    entry = build_registry_entry(
        experiment_key="dip_buyer_v2",
        artifact_family="strategy",
        owner="backtester",
        status="draft",
    )

    transitioned = transition_registry_entry(
        entry,
        to_status="shadow",
        reason="baseline comparison started",
        decided_at="2026-04-03T16:00:00+00:00",
    )

    assert transitioned["status"] == "shadow"
    assert transitioned["audit"]["transition_count"] == 1
    assert transitioned["audit"]["last_transition_reason"] == "baseline comparison started"


def test_registry_duplicate_keys_fail_fast():
    entry = build_registry_entry(
        experiment_key="dip_buyer_v2",
        artifact_family="strategy",
        owner="backtester",
        status="draft",
    )
    with pytest.raises(GovernanceRegistryError, match="duplicate experiment_key"):
        load_experiment_registry_from_payload(
            {
                "schema_version": 1,
                "experiments": [entry, dict(entry)],
            }
        )


def test_registry_save_and_load_round_trip(tmp_path):
    entry = build_registry_entry(
        experiment_key="dip_buyer_v2",
        artifact_family="strategy",
        owner="backtester",
        status="shadow",
    )
    path = tmp_path / "experiment_registry.json"
    save_experiment_registry({"schema_version": 1, "experiments": [entry]}, path)

    loaded = load_experiment_registry(path)

    assert loaded["experiments"][0]["experiment_key"] == "dip_buyer_v2"
    assert loaded["experiments"][0]["status"] == "shadow"


def test_governance_decision_artifact_preserves_lineage_and_effective_dates():
    artifact = build_governance_decision_artifact(
        experiment_key="dip_buyer_v2",
        decision_type="promotion",
        decision_result="advisory",
        gate_results={"benchmark_pass": True},
        reasons=["compare-only rollout"],
        effective_from="2026-04-04T09:30:00+00:00",
        lineage={"walk_forward": "walk_forward_summary"},
        generated_at="2026-04-03T16:00:00+00:00",
    )

    assert artifact["artifact_family"] == "governance_decision"
    assert artifact["decision_result"] == "advisory"
    assert artifact["effective_from"] == "2026-04-04T09:30:00+00:00"
    assert artifact["lineage"]["walk_forward"] == "walk_forward_summary"


def test_governance_configs_load_from_repo_files():
    gates = load_promotion_gates()
    demotion = load_demotion_rules()

    assert gates["promotion_gates"]["require_benchmark_pass"] is True
    assert demotion["demotion_rules"]["maximum_consecutive_failed_reviews"] == 2
