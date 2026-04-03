from __future__ import annotations

from operator_surfaces.renderers import render_operator_payload


def test_render_operator_payload_uses_shared_contract_truth():
    rendered = render_operator_payload(
        {
            "artifact_family": "operator_payload",
            "schema_version": 1,
            "producer": "backtester.market_brief_snapshot",
            "status": "degraded",
            "generated_at": "2026-04-03T12:00:00+00:00",
            "known_at": "2026-04-03T12:00:00+00:00",
            "degraded_status": "degraded_safe",
            "outcome_class": "market_gate_blocked",
            "payload_key": "market_brief:1",
            "surface_type": "brief",
            "summary": {
                "headline": "OPEN: NO_BUY | CORRECTION | size 0%",
                "what_this_means": "Stay defensive.",
                "read_this_as": {
                    "session": "This is a regular session snapshot.",
                    "regime": "Market regime is CORRECTION (15m old).",
                    "tape": "Tape is using fresh live quotes.",
                    "focus": "OXY, GEV, FANG.",
                },
            },
            "decision_contract_ref": {
                "artifact_family": "decision_state",
                "producer": "backtester.market_brief_snapshot",
                "generated_at": "2026-04-03T12:00:00+00:00",
            },
            "source_refs": {
                "market_brief": {
                    "artifact_family": "market_brief",
                    "producer": "backtester.market_brief_snapshot",
                    "generated_at": "2026-04-03T12:00:00+00:00",
                }
            },
            "health": {"status": "degraded", "warnings": []},
            "warnings": ["one", "two", "three", "four"],
        }
    )

    assert "OPEN: NO_BUY | CORRECTION | size 0%" in rendered
    assert "Status: valid defensive snapshot; market regime is blocking new risk." in rendered
    assert "Session: This is a regular session snapshot." in rendered
    assert "Warnings: one, two, three" in rendered
