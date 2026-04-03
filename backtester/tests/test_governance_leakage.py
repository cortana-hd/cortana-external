from __future__ import annotations

from governance.leakage import build_point_in_time_audit_artifact


def test_point_in_time_audit_blocks_known_at_leakage():
    artifact = build_point_in_time_audit_artifact(
        experiment_key="dip_buyer_v2",
        records=[
            {
                "generated_at": "2026-04-03T16:00:00+00:00",
                "known_at": "2026-04-03T16:05:00+00:00",
                "producer": "backtester.test",
                "input_provenance": {"source": "schwab"},
                "data_source": "schwab",
                "data_status": "ok",
                "universe_membership": {"base_universe": True},
                "corporate_actions_applied": True,
            }
        ],
    )

    assert artifact["pass_fail_summary"]["passed"] is False
    assert "known_at_order" in artifact["leakage_findings"]


def test_point_in_time_audit_flags_live_cache_mixing_and_missing_provenance():
    artifact = build_point_in_time_audit_artifact(
        experiment_key="dip_buyer_v2",
        records=[
            {
                "generated_at": "2026-04-03T16:00:00+00:00",
                "known_at": "2026-04-03T15:55:00+00:00",
                "producer": "backtester.test",
                "input_provenance": {"source": "schwab"},
                "data_source": "schwab",
                "data_status": "ok",
                "universe_membership": {"base_universe": True},
                "corporate_actions_applied": True,
            },
            {
                "generated_at": "2026-04-03T16:10:00+00:00",
                "known_at": "2026-04-03T16:00:00+00:00",
                "producer": "",
                "input_provenance": {},
                "data_source": "cache",
                "data_status": "degraded",
                "universe_membership": None,
                "corporate_actions_applied": None,
            },
        ],
    )

    assert artifact["provenance_integrity_audit"]["passed"] is False
    assert artifact["live_vs_cache_mixing_audit"]["passed"] is False
    assert artifact["pass_fail_summary"]["passed"] is False
