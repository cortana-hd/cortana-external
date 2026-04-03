from __future__ import annotations

import pytest

from evaluation.artifact_contracts import ARTIFACT_FAMILY_OPERATOR_PAYLOAD
from operator_surfaces.compatibility import assert_consumer_compatible


def test_assert_consumer_compatible_accepts_supported_schema():
    payload = assert_consumer_compatible(
        {
            "artifact_family": ARTIFACT_FAMILY_OPERATOR_PAYLOAD,
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
            "source_refs": {
                "market_brief": {
                    "artifact_family": "market_brief",
                    "producer": "backtester.market_brief_snapshot",
                    "generated_at": "2026-04-03T12:00:00+00:00",
                }
            },
            "health": {"status": "ok"},
            "warnings": [],
        },
        expected_family=ARTIFACT_FAMILY_OPERATOR_PAYLOAD,
        supported_schema_versions=(1,),
    )
    assert payload["surface_type"] == "brief"


def test_assert_consumer_compatible_fails_loudly_on_schema_mismatch():
    with pytest.raises(ValueError, match="incompatible schema_version 2"):
        assert_consumer_compatible(
            {
                "artifact_family": ARTIFACT_FAMILY_OPERATOR_PAYLOAD,
                "schema_version": 2,
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
                "source_refs": {
                    "market_brief": {
                        "artifact_family": "market_brief",
                        "producer": "backtester.market_brief_snapshot",
                        "generated_at": "2026-04-03T12:00:00+00:00",
                    }
                },
                "health": {"status": "ok"},
                "warnings": [],
            },
            expected_family=ARTIFACT_FAMILY_OPERATOR_PAYLOAD,
            supported_schema_versions=(1,),
        )
