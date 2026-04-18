from governance.authority import build_strategy_authority_tiers_artifact, synthesize_strategy_authority_row
from governance.autonomy_tiers import build_supervised_live_review_window, evaluate_autonomy_transition


def test_strategy_authority_tier_promotes_fresh_family_with_depth():
    row = synthesize_strategy_authority_row(
        {
            "strategy_family": "dip_buyer",
            "sample_depth": 32,
            "profit_factor": 1.21,
            "hit_rate": 0.58,
            "avg_return_pct": 1.4,
            "max_drawdown": 3.2,
            "health_status": "fresh",
            "regime_coverage": {"regime_count": 3},
            "warnings": [],
        }
    )

    assert row["authority_tier"] == "trusted"
    assert row["autonomy_mode"] == "supervised_live"
    assert row["decision_reason"]["authority_weight"] == 1.0


def test_strategy_authority_tier_demotes_negative_or_stale_family():
    row = synthesize_strategy_authority_row(
        {
            "strategy_family": "canslim",
            "sample_depth": 28,
            "profit_factor": 0.91,
            "hit_rate": 0.44,
            "avg_return_pct": -0.9,
            "max_drawdown": 4.0,
            "health_status": "stale",
            "regime_coverage": {"regime_count": 1},
        }
    )

    assert row["authority_tier"] == "demoted"
    assert row["autonomy_mode"] == "advisory"
    assert "stale_summary" in row["decision_reason"]["blocking_factors"]


def test_autonomy_transition_requires_trusted_supervised_live_depth_and_signoff(tmp_path):
    authority = build_strategy_authority_tiers_artifact(
        [
            {
                "strategy_family": "dip_buyer",
                "sample_depth": 280,
                "profit_factor": 1.16,
                "hit_rate": 0.57,
                "avg_return_pct": 1.1,
                "max_drawdown": 3.6,
                "health_status": "fresh",
                "regime_coverage": {"regime_count": 3},
            }
        ],
        operator_rationale={"dip_buyer": {"autonomy_mode": "supervised_live"}},
        root=tmp_path / "strategy-authority.json",
    )
    review = build_supervised_live_review_window(
        strategy_family="dip_buyer",
        started_at="2026-04-10T13:30:00+00:00",
        ended_at="2026-04-17T20:00:00+00:00",
        operator_signoff={"status": "approved", "actor": "hamel"},
        outcome_summary={"silent_fallback": False},
    )

    gate = evaluate_autonomy_transition(
        authority_artifact=authority,
        review_window_artifact=review,
        requested_mode="guarded_live",
    )

    assert gate["state"] == "eligible"
    assert gate["eligible_families"] == ["dip_buyer"]


def test_autonomy_transition_blocks_missing_signoff_or_unresolved_incident():
    gate = evaluate_autonomy_transition(
        authority_artifact={
            "families": [
                {
                    "strategy_family": "dip_buyer",
                    "authority_tier": "trusted",
                    "autonomy_mode": "supervised_live",
                    "sample_depth": 260,
                    "benchmark_summary": {"avg_return_pct": 0.8},
                    "regime_coverage": {"regime_count": 2},
                }
            ]
        },
        review_window_artifact=build_supervised_live_review_window(
            strategy_family="dip_buyer",
            started_at="2026-04-10T13:30:00+00:00",
            unresolved_incidents=[{"incident": "fallback"}],
            operator_signoff={"status": "pending"},
        ),
    )

    assert gate["state"] == "blocked"
    assert "dip_buyer:unresolved_incidents" in gate["blocking_factors"]
    assert "dip_buyer:missing_operator_signoff" in gate["blocking_factors"]
