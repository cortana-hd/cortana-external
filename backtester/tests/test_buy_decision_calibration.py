from __future__ import annotations

import json
from datetime import UTC, datetime
from types import SimpleNamespace

from buy_decision_calibration import (
    build_buy_decision_calibration_artifact,
    generate_buy_decision_calibration_artifact,
)


def _record(
    *,
    paper_action: str,
    calibrated_prob: float,
    ret_5d: float | None,
    ret_10d: float | None,
    settled_at: str,
    execution_quality: str = "good",
    liquidity_tier: str = "tier1",
    risk_budget_state: str = "tight",
    aggression_posture: str = "selective",
    market_regime: str | None = None,
):
    return SimpleNamespace(
        paper_action=paper_action,
        calibrated_prob=calibrated_prob,
        forward_returns={"5d": ret_5d, "10d": ret_10d},
        settled_at=settled_at,
        execution_quality=execution_quality,
        liquidity_tier=liquidity_tier,
        risk_budget_state=risk_budget_state,
        aggression_posture=aggression_posture,
        market_regime=market_regime,
    )


def test_artifact_includes_action_and_bucket_calibration_when_available():
    generated_at = datetime(2026, 3, 19, 15, 0, tzinfo=UTC)
    records = [
        _record(
            paper_action="paper_long",
            calibrated_prob=0.62,
            ret_5d=0.03,
            ret_10d=0.05,
            settled_at="2026-03-19T14:00:00+00:00",
            execution_quality="good",
            liquidity_tier="tier1",
            market_regime="confirmed_uptrend",
        ),
        _record(
            paper_action="paper_long",
            calibrated_prob=0.58,
            ret_5d=-0.02,
            ret_10d=-0.01,
            settled_at="2026-03-19T14:05:00+00:00",
            execution_quality="fair",
            liquidity_tier="tier2",
            market_regime="confirmed_uptrend",
        ),
        _record(
            paper_action="track",
            calibrated_prob=0.55,
            ret_5d=0.01,
            ret_10d=0.02,
            settled_at="2026-03-19T14:10:00+00:00",
            execution_quality="good",
            liquidity_tier="tier1",
            market_regime="uptrend_under_pressure",
        ),
    ]

    artifact = build_buy_decision_calibration_artifact(
        records,
        generated_at=generated_at,
        minimum_samples=2,
        min_bucket_count=1,
        max_age_hours=24.0,
    )

    assert artifact["schema_version"] == 1
    assert artifact["artifact_type"] == "buy_decision_calibration"
    assert artifact["freshness"]["is_stale"] is False
    assert artifact["summary"]["promotion_gate"]["minimum_samples"] == 2

    by_action = {item["action"]: item for item in artifact["calibration"]["by_action"]}
    assert by_action["paper_long"]["count"] == 2
    assert by_action["track"]["count"] == 1

    by_dimension = artifact["calibration"]["by_dimension"]
    assert "execution_quality" in by_dimension
    assert "liquidity_tier" in by_dimension
    assert "market_regime" in by_dimension
    assert by_dimension["execution_quality"][0]["count"] >= 1


def test_artifact_marks_stale_when_latest_settled_record_is_old():
    artifact = build_buy_decision_calibration_artifact(
        [
            _record(
                paper_action="paper_long",
                calibrated_prob=0.6,
                ret_5d=0.01,
                ret_10d=0.02,
                settled_at="2026-03-10T12:00:00+00:00",
            )
        ],
        generated_at=datetime(2026, 3, 19, 12, 0, tzinfo=UTC),
        max_age_hours=24.0,
    )

    assert artifact["freshness"]["is_stale"] is True
    assert artifact["freshness"]["reason"] == "stale_settled_records"


def test_artifact_handles_empty_records_as_stale_with_no_buckets():
    artifact = build_buy_decision_calibration_artifact(
        [],
        generated_at=datetime(2026, 3, 19, 12, 0, tzinfo=UTC),
    )

    assert artifact["freshness"]["is_stale"] is True
    assert artifact["freshness"]["reason"] == "no_settled_records"
    assert artifact["calibration"]["by_action"] == []
    assert artifact["calibration"]["by_dimension"] == {}


def test_generate_artifact_writes_file_backed_output(tmp_path):
    root = tmp_path / "alpha"
    settled_dir = root / "settled"
    settled_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": "2026-03-18T12:00:00+00:00",
        "settled_at": "2026-03-19T11:00:00+00:00",
        "candidates": [
            {
                "generated_at": "2026-03-18T12:00:00+00:00",
                "symbol": "AAA",
                "provider_symbol": "AAA",
                "asset_class": "stock",
                "paper_action": "paper_long",
                "verdict": "actionable",
                "conviction": "supportive",
                "divergence_state": "none",
                "severity": "major",
                "persistence": "persistent",
                "calibrated_prob": 0.62,
                "edge": 0.12,
                "kelly_fraction": 0.08,
                "entry_price": 100.0,
                "forward_returns": {"1d": 0.01, "5d": 0.03, "10d": 0.05},
                "settled_horizons": [1, 5, 10],
                "realized_label": "validated_long",
                "settled_at": "2026-03-19T11:00:00+00:00",
                "rationale": "test",
                "risk_budget_state": "tight",
                "aggression_posture": "selective",
                "execution_quality": "good",
                "liquidity_tier": "tier1",
                "spread_bps": 6.0,
                "slippage_bps": 9.0,
                "avg_dollar_volume_musd": 20.0,
                "overlay_notes": "spread 6.0bp; slip 9.0bp",
            }
        ],
    }
    (settled_dir / "2026-03-18T12-00-00+00-00.json").write_text(json.dumps(payload), encoding="utf-8")

    artifact, path = generate_buy_decision_calibration_artifact(
        alpha_root=root,
        minimum_samples=1,
    )

    assert path.exists()
    parsed = json.loads(path.read_text(encoding="utf-8"))
    assert parsed["artifact_type"] == "buy_decision_calibration"
    assert parsed["source"]["record_count"] == 1
    assert artifact["summary"]["promotion_gate"]["status"] == "ready"
