from control_loop.actual_state import build_actual_state_artifact
from control_loop.desired_state import build_desired_state_artifact
from control_loop.interventions import build_intervention_events_artifact, derive_intervention_events
from control_loop.reconciler import build_reconciliation_actions_artifact
from release.drift_monitor import build_drift_monitor_artifact
from release.release_units import build_release_unit_artifact


def test_desired_actual_and_reconciliation_preserve_distinct_contracts():
    release_unit = build_release_unit_artifact(
        generated_at="2026-04-18T14:00:00+00:00",
        release_key="bt-v4-control-loop",
        code_ref="abc1234",
        strategy_refs=["dip_buyer", "canslim"],
        config_refs=["backtester/governance/promotion_gates.json"],
    )
    desired = build_desired_state_artifact(
        snapshot_at="2026-04-18T14:00:00+00:00",
        posture_artifact={
            "posture_state": "selective",
            "drawdown_state": {"allowed_gross_exposure_fraction": 0.4},
            "strategy_allocations": [
                {
                    "strategy_family": "dip_buyer",
                    "budget_amount": 25000,
                    "authority_tier": "trusted",
                    "autonomy_mode": "supervised_live",
                }
            ],
            "summary": {"top_strategy_family": "dip_buyer"},
        },
        authority_artifact={
            "authority_counts": {"trusted": 1},
            "summary": {"highest_autonomy_mode": "supervised_live"},
            "families": [{"strategy_family": "dip_buyer", "authority_tier": "trusted", "autonomy_mode": "supervised_live"}],
        },
        release_target=release_unit,
    )
    drift = build_drift_monitor_artifact(
        generated_at="2026-04-18T14:00:00+00:00",
        runtime_health_artifact={"status": "ok"},
        release_unit_artifact=release_unit,
        posture_artifact={"posture_state": "paused"},
    )
    actual = build_actual_state_artifact(
        snapshot_at="2026-04-18T14:00:00+00:00",
        posture_artifact={"posture_state": "paused", "gross_exposure": 0.55},
        portfolio_snapshot={"summary": {"open_count": 3, "closed_total_count": 10}, "gross_exposure_pct": 0.55},
        authority_artifact={"authority_counts": {"trusted": 1}, "summary": {"highest_autonomy_mode": "supervised_live"}},
        runtime_health_artifact={"status": "ok", "incident_markers": []},
        runtime_inventory_artifact={"components": [{"component_key": "external_service"}]},
        drift_artifact=drift,
        release_unit_artifact=release_unit,
    )
    interventions = build_intervention_events_artifact(
        generated_at="2026-04-18T14:00:00+00:00",
        events=derive_intervention_events(
            generated_at="2026-04-18T14:00:00+00:00",
            actual_state_artifact=actual,
            drift_artifact=drift,
            release_unit_artifact=release_unit,
        ),
    )
    reconciliation = build_reconciliation_actions_artifact(
        generated_at="2026-04-18T14:00:00+00:00",
        desired_state_artifact=desired,
        actual_state_artifact=actual,
        interventions_artifact=interventions,
    )

    assert desired["artifact_family"] == "trading_desired_state"
    assert actual["artifact_family"] == "trading_actual_state"
    assert reconciliation["artifact_family"] == "trading_reconciliation_actions"
    assert desired["summary"]["desired_posture_state"] == "selective"
    assert actual["summary"]["actual_posture_state"] == "paused"
    assert interventions["active_event_count"] >= 1
    assert any(action["action_type"] == "rebalance_posture" for action in reconciliation["actions"])
    assert any(action["action_type"] == "respect_manual_pause" for action in reconciliation["actions"])


def test_release_validation_and_drift_hold_rollout():
    release_unit = build_release_unit_artifact(
        generated_at="2026-04-18T14:00:00+00:00",
        release_key="bt-v4-canary",
        code_ref="",
        strategy_refs=[],
        config_refs=[],
        canary_state={"mode": "canary", "stage": "canary", "status": "warn"},
    )
    drift = build_drift_monitor_artifact(
        generated_at="2026-04-18T14:00:00+00:00",
        runtime_health_artifact={"status": "ok"},
        release_unit_artifact=release_unit,
        posture_artifact={"posture_state": "selective"},
    )

    assert release_unit["validation"]["is_valid"] is False
    assert drift["policy_outcome"]["action"] == "hold_rollout"
    assert drift["summary"]["drift_status"] == "degraded"
