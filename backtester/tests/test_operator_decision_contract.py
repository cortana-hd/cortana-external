from __future__ import annotations

import pytest

from operator_surfaces.decision_contract import (
    build_operator_payload,
    validate_operator_payload,
)


def test_build_operator_payload_requires_source_references():
    payload = build_operator_payload(
        payload_key="market_brief:1",
        producer="backtester.market_brief_snapshot",
        surface_type="brief",
        generated_at="2026-04-03T12:00:00+00:00",
        status="ok",
        degraded_status="healthy",
        outcome_class="market_gate_blocked",
        summary={"headline": "OPEN: NO_BUY | CORRECTION | size 0%", "what_this_means": "Stay defensive."},
        decision_contract_ref={
            "artifact_family": "decision_state",
            "producer": "backtester.market_brief_snapshot",
            "generated_at": "2026-04-03T12:00:00+00:00",
        },
        source_refs={
            "market_brief": {
                "artifact_family": "market_brief",
                "producer": "backtester.market_brief_snapshot",
                "generated_at": "2026-04-03T12:00:00+00:00",
            }
        },
        health={"status": "ok", "warnings": []},
    )
    assert payload["artifact_family"] == "operator_payload"
    assert payload["summary"]["headline"].startswith("OPEN:")


def test_validate_operator_payload_rejects_missing_source_ref_fields():
    with pytest.raises(ValueError, match="source_refs.market_brief missing required fields"):
        validate_operator_payload(
            {
                "artifact_family": "operator_payload",
                "schema_version": 1,
                "producer": "backtester.market_brief_snapshot",
                "status": "ok",
                "generated_at": "2026-04-03T12:00:00+00:00",
                "known_at": "2026-04-03T12:00:00+00:00",
                "degraded_status": "healthy",
                "payload_key": "market_brief:1",
                "surface_type": "brief",
                "summary": {"headline": "OPEN", "what_this_means": "Stay defensive."},
                "decision_contract_ref": {
                    "artifact_family": "decision_state",
                    "producer": "backtester.market_brief_snapshot",
                    "generated_at": "2026-04-03T12:00:00+00:00",
                },
                "source_refs": {"market_brief": {"artifact_family": "market_brief"}},
                "health": {"status": "ok"},
                "warnings": [],
            }
        )
