from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pandas as pd

from evaluation.prediction_accuracy import (
    build_prediction_accuracy_summary,
    persist_prediction_snapshot,
    settle_prediction_snapshots,
)


class _StubProvider:
    def get_history(self, symbol: str, period: str = "6mo"):
        frame = pd.DataFrame(
            {
                "Open": [10.0, 11.0, 12.0],
                "High": [10.0, 11.0, 12.0],
                "Low": [10.0, 11.0, 12.0],
                "Close": [10.0, 11.0, 12.0],
                "Volume": [100, 100, 100],
            },
            index=pd.to_datetime(
                [
                    datetime(2026, 3, 1, tzinfo=timezone.utc),
                    datetime(2026, 3, 3, tzinfo=timezone.utc),
                    datetime(2026, 3, 25, tzinfo=timezone.utc),
                ]
            ),
        )
        return type("History", (), {"frame": frame})()


def test_prediction_accuracy_round_trip(tmp_path):
    generated_at = datetime(2026, 3, 1, tzinfo=timezone.utc)
    path = persist_prediction_snapshot(
        strategy="dip_buyer",
        market_regime="correction",
        records=[{
            "symbol": "AAPL",
            "action": "WATCH",
            "score": 8,
            "effective_confidence": 61,
            "confidence": 61,
            "risk": "medium",
            "market_regime": "correction",
            "breadth_state": "inactive",
            "entry_plan_ref": "dip_buyer.reversal_watch_v1",
            "execution_policy_ref": None,
            "vetoes": [],
            "uncertainty_pct": 18,
            "trade_quality_score": 72,
            "reason": "test",
        }],
        root=tmp_path,
        generated_at=generated_at,
        producer="backtester.test_prediction_accuracy",
    )

    payload = json.loads(path.read_text(encoding="utf-8"))
    record = payload["records"][0]
    assert payload["schema_version"] == 1
    assert record["schema_version"] == 1
    assert record["producer"] == "backtester.test_prediction_accuracy"
    assert record["strategy"] == "dip_buyer"
    assert record["strategy_family"] == "dip_buyer"
    assert record["market_regime"] == "correction"
    assert record["predicted_at"] == generated_at.isoformat()
    assert record["risk"] == "medium"
    assert record["entry_plan_ref"] == "dip_buyer.reversal_watch_v1"
    assert record["execution_policy_ref"] is None
    assert record["vetoes"] == []

    settle_prediction_snapshots(root=tmp_path, provider=_StubProvider(), now=generated_at + timedelta(days=30))
    settled_payload = json.loads(
        next((tmp_path / "settled").glob("*.json")).read_text(encoding="utf-8")
    )
    settled_record = settled_payload["records"][0]
    assert settled_payload["schema_version"] == 1
    assert settled_record["settlement_schema_version"] == 1
    assert settled_record["settlement_status"] == "settled"
    assert settled_record["settlement_maturity_state"] == "matured"
    assert settled_record["matured_horizons"] == ["1d", "5d", "20d"]
    assert settled_record["pending_horizons"] == []
    assert settled_record["incomplete_horizons"] == []
    assert settled_record["matured_coverage_pct"] == 1.0
    assert settled_record["pending_coverage_pct"] == 0.0
    assert settled_record["max_favorable_excursion_pct"]["20d"] == 20.0
    assert settled_record["max_adverse_excursion_pct"]["20d"] == 0.0
    assert settled_record["validation_horizon_key"] == "5d"
    assert settled_record["signal_validation_grade"] == "good"
    assert settled_record["entry_validation_grade"] == "good"
    assert settled_record["execution_validation_grade"] == "unknown"
    assert settled_record["trade_validation_grade"] == "unknown"
    summary = build_prediction_accuracy_summary(root=tmp_path)

    assert summary["schema_version"] == 1
    assert summary["artifact_family"] == "prediction_accuracy_summary"
    assert summary["settlement_status_counts"]["settled"] == 1
    assert summary["maturity_state_counts"]["matured"] == 1
    assert summary["validation_grade_counts"]["signal_validation_grade"]["good"] == 1
    assert summary["snapshot_count"] == 1
    assert summary["record_count"] == 1
    assert summary["horizon_status"]["1d"]["matured"] == 1
    assert summary["horizon_status"]["20d"]["matured"] == 1
    bucket = summary["summary"][0]
    assert bucket["strategy"] == "dip_buyer"
    assert bucket["action"] == "WATCH"
    assert bucket["20d"]["samples"] == 1
    assert bucket["20d"]["decision_accuracy_label"] == "watch_success_rate"
    assert bucket["20d"]["decision_accuracy"] == 1.0
    regime_bucket = summary["by_regime"][0]
    assert regime_bucket["market_regime"] == "correction"
    confidence_bucket = summary["by_confidence_bucket"][0]
    assert confidence_bucket["confidence_bucket"] == "medium"
    scorecard_path = tmp_path / "reports" / "strategy-scorecard-latest.json"
    assert scorecard_path.exists()


class _NegativeStubProvider:
    def get_history(self, symbol: str, period: str = "6mo"):
        frame = pd.DataFrame(
            {
                "Open": [10.0, 9.0, 8.0],
                "High": [10.0, 9.0, 8.0],
                "Low": [10.0, 9.0, 8.0],
                "Close": [10.0, 9.0, 8.0],
                "Volume": [100, 100, 100],
            },
            index=pd.to_datetime(
                [
                    datetime(2026, 3, 1, tzinfo=timezone.utc),
                    datetime(2026, 3, 3, tzinfo=timezone.utc),
                    datetime(2026, 3, 25, tzinfo=timezone.utc),
                ]
            ),
        )
        return type("History", (), {"frame": frame})()


class _ShortHistoryStubProvider:
    def get_history(self, symbol: str, period: str = "6mo"):
        frame = pd.DataFrame(
            {
                "Open": [10.0, 11.0],
                "High": [10.0, 11.0],
                "Low": [10.0, 11.0],
                "Close": [10.0, 11.0],
                "Volume": [100, 100],
            },
            index=pd.to_datetime(
                [
                    datetime(2026, 3, 1, tzinfo=timezone.utc),
                    datetime(2026, 3, 3, tzinfo=timezone.utc),
                ]
            ),
        )
        return type("History", (), {"frame": frame})()


def test_prediction_accuracy_uses_action_aware_avoidance_rate_for_no_buy(tmp_path):
    generated_at = datetime(2026, 3, 1, tzinfo=timezone.utc)
    persist_prediction_snapshot(
        strategy="canslim",
        market_regime="correction",
        records=[{
            "symbol": "MSFT",
            "action": "NO_BUY",
            "score": 6,
            "effective_confidence": 29,
            "confidence": 29,
            "risk": "high",
            "market_regime": "correction",
            "breadth_state": None,
            "entry_plan_ref": None,
            "execution_policy_ref": None,
            "vetoes": ["market_regime"],
            "reason": "test",
        }],
        root=tmp_path,
        generated_at=generated_at,
    )

    settle_prediction_snapshots(root=tmp_path, provider=_NegativeStubProvider(), now=generated_at + timedelta(days=30))
    summary = build_prediction_accuracy_summary(root=tmp_path)

    bucket = summary["summary"][0]
    assert bucket["action"] == "NO_BUY"
    assert bucket["20d"]["decision_accuracy_label"] == "avoidance_rate"
    assert bucket["20d"]["decision_accuracy"] == 1.0
    assert bucket["20d"]["avg_return_pct"] < 0


def test_prediction_accuracy_skips_fresh_settlement_when_market_data_unavailable(tmp_path, monkeypatch):
    generated_at = datetime(2026, 3, 1, tzinfo=timezone.utc)
    path = persist_prediction_snapshot(
        strategy="dip_buyer",
        market_regime="correction",
        records=[{
            "symbol": "AAPL",
            "action": "WATCH",
            "score": 8,
            "effective_confidence": 61,
            "confidence": 61,
            "risk": "medium",
            "market_regime": "correction",
            "breadth_state": "inactive",
            "entry_plan_ref": "dip_buyer.reversal_watch_v1",
            "execution_policy_ref": None,
            "vetoes": [],
            "uncertainty_pct": 18,
            "trade_quality_score": 72,
            "reason": "test",
        }],
        root=tmp_path,
        generated_at=generated_at,
        producer="backtester.test_prediction_accuracy",
    )
    settled_dir = tmp_path / "settled"
    settled_dir.mkdir(parents=True, exist_ok=True)
    existing = {
        "schema_version": 1,
        "artifact_family": "prediction_settlement",
        "strategy": "dip_buyer",
        "market_regime": "correction",
        "generated_at": generated_at.isoformat(),
        "settled_at": generated_at.isoformat(),
        "settlement_horizons": ["1d", "5d", "20d"],
        "record_count": 1,
        "settlement_summary": {},
        "records": [{
            "symbol": "AAPL",
            "action": "WATCH",
            "pending_horizons": [],
            "incomplete_horizons": [],
        }],
    }
    (settled_dir / path.name).write_text(json.dumps(existing), encoding="utf-8")

    class _ExplodingProvider:
        def get_history(self, symbol: str, period: str = "6mo"):
            raise AssertionError("provider should not be called when settlement is skipped")

    monkeypatch.setattr("evaluation.prediction_accuracy._market_data_available_for_settlement", lambda provider: False)

    settled = settle_prediction_snapshots(root=tmp_path, provider=_ExplodingProvider(), now=generated_at + timedelta(days=30))

    assert settled == []
    persisted = json.loads((settled_dir / path.name).read_text(encoding="utf-8"))
    assert persisted["records"][0]["symbol"] == "AAPL"


def test_prediction_snapshot_contract_requires_reason(tmp_path):
    generated_at = datetime(2026, 3, 1, tzinfo=timezone.utc)
    try:
        persist_prediction_snapshot(
            strategy="canslim",
            market_regime="correction",
            records=[{
                "symbol": "MSFT",
                "action": "BUY",
                "score": 8,
                "effective_confidence": 70,
                "confidence": 70,
                "risk": "medium",
                "market_regime": "confirmed_uptrend",
                "breadth_state": None,
                "entry_plan_ref": "canslim.breakout_entry_v1",
                "execution_policy_ref": None,
                "vetoes": [],
            }],
            root=tmp_path,
            generated_at=generated_at,
            producer="backtester.test_prediction_accuracy",
        )
    except ValueError as error:
        assert "requires explicit producer fields" in str(error)
        assert "reason" in str(error)
    else:
        raise AssertionError("persist_prediction_snapshot should reject records without a reason")


def test_prediction_snapshot_contract_requires_explicit_surface_fields(tmp_path):
    generated_at = datetime(2026, 3, 1, tzinfo=timezone.utc)
    try:
        persist_prediction_snapshot(
            strategy="canslim",
            market_regime="correction",
            records=[{
                "symbol": "MSFT",
                "action": "BUY",
                "score": 8,
                "effective_confidence": 70,
                "reason": "Strong setup",
            }],
            root=tmp_path,
            generated_at=generated_at,
            producer="backtester.test_prediction_accuracy",
        )
    except ValueError as error:
        assert "requires explicit producer fields" in str(error)
        assert "risk" in str(error)
        assert "market_regime" in str(error)
    else:
        raise AssertionError("persist_prediction_snapshot should reject records missing explicit contract fields")


def test_prediction_snapshot_contract_preserves_explicit_fields(tmp_path):
    generated_at = datetime(2026, 3, 1, tzinfo=timezone.utc)
    path = persist_prediction_snapshot(
        strategy="dip_buyer",
        market_regime="correction",
        records=[
            {
                "symbol": "NVDA",
                "action": "WATCH",
                "score": 9,
                "effective_confidence": 68,
                "confidence": 68,
                "market_regime": "correction",
                "risk": "medium",
                "breadth_state": "inactive",
                "entry_plan_ref": "dip_buyer.reversal_watch_v1",
                "execution_policy_ref": "execution.good.tight",
                "vetoes": ["market_regime", "abstain:confidence"],
                "reason": "Breadth is inactive so the setup stays watch-only.",
            }
        ],
        root=tmp_path,
        generated_at=generated_at,
        producer="backtester.test_prediction_accuracy",
    )

    payload = json.loads(path.read_text(encoding="utf-8"))
    record = payload["records"][0]
    assert record["risk"] == "medium"
    assert record["breadth_state"] == "inactive"
    assert record["entry_plan_ref"] == "dip_buyer.reversal_watch_v1"
    assert record["execution_policy_ref"] == "execution.good.tight"
    assert record["vetoes"] == ["market_regime", "abstain:confidence"]


def test_prediction_settlement_tracks_pending_and_incomplete_horizons(tmp_path):
    generated_at = datetime(2026, 3, 1, tzinfo=timezone.utc)
    path = persist_prediction_snapshot(
        strategy="dip_buyer",
        market_regime="correction",
        records=[
            {
                "symbol": "AAPL",
                "action": "WATCH",
                "score": 8,
                "effective_confidence": 61,
                "confidence": 61,
                "risk": "medium",
                "market_regime": "correction",
                "breadth_state": "inactive",
                "entry_plan_ref": "dip_buyer.reversal_watch_v1",
                "execution_policy_ref": None,
                "vetoes": [],
                "reason": "test",
            }
        ],
        root=tmp_path,
        generated_at=generated_at,
        producer="backtester.test_prediction_accuracy",
    )
    assert path is not None

    settle_prediction_snapshots(root=tmp_path, provider=_ShortHistoryStubProvider(), now=generated_at + timedelta(days=30))
    settled_payload = json.loads(
        next((tmp_path / "settled").glob("*.json")).read_text(encoding="utf-8")
    )
    record = settled_payload["records"][0]
    assert record["settlement_status"] == "partially_settled"
    assert record["settlement_maturity_state"] == "partial"
    assert record["matured_horizons"] == ["1d"]
    assert record["pending_horizons"] == []
    assert record["incomplete_horizons"] == ["5d", "20d"]
    assert record["matured_coverage_pct"] == 0.3333
    assert record["incomplete_coverage_pct"] == 0.6667
    assert record["settlement_maturity_state"] == "partial"
    assert record["signal_validation_grade"] == "good"
    assert record["entry_validation_grade"] == "good"
    assert record["execution_validation_grade"] == "unknown"
    assert record["trade_validation_grade"] == "unknown"


def test_prediction_settlement_grades_no_buy_avoidance(tmp_path):
    generated_at = datetime(2026, 3, 1, tzinfo=timezone.utc)
    persist_prediction_snapshot(
        strategy="canslim",
        market_regime="correction",
        records=[{
            "symbol": "MSFT",
            "action": "NO_BUY",
            "score": 6,
            "effective_confidence": 29,
            "confidence": 29,
            "risk": "high",
            "market_regime": "correction",
            "breadth_state": None,
            "entry_plan_ref": None,
            "execution_policy_ref": None,
            "vetoes": ["market_regime"],
            "reason": "test",
        }],
        root=tmp_path,
        generated_at=generated_at,
    )

    settle_prediction_snapshots(root=tmp_path, provider=_NegativeStubProvider(), now=generated_at + timedelta(days=30))
    settled_payload = json.loads(
        next((tmp_path / "settled").glob("*.json")).read_text(encoding="utf-8")
    )
    record = settled_payload["records"][0]
    assert record["signal_validation_grade"] == "good"
    assert record["entry_validation_grade"] == "not_applicable"
    assert record["execution_validation_grade"] == "not_applicable"
    assert record["trade_validation_grade"] == "good"


def test_prediction_accuracy_summary_includes_grouped_and_rolling_rollups(tmp_path):
    settled_dir = tmp_path / "settled"
    settled_dir.mkdir(parents=True, exist_ok=True)

    records: list[dict] = []
    for idx in range(25):
        records.append(
            {
                "symbol": f"T{idx:02d}",
                "action": "BUY" if idx % 2 == 0 else "NO_BUY",
                "confidence": 82 if idx % 3 == 0 else 48,
                "market_regime": "confirmed_uptrend" if idx < 10 else "correction",
                "predicted_at": (datetime(2026, 3, 1, tzinfo=timezone.utc) + timedelta(days=idx)).isoformat(),
                "settlement_status": "settled",
                "settlement_maturity_state": "matured",
                "signal_validation_grade": "good",
                "entry_validation_grade": "good" if idx % 2 == 0 else "not_applicable",
                "execution_validation_grade": "unknown",
                "trade_validation_grade": "good",
                "forward_returns_pct": {"5d": 4.0 if idx % 2 == 0 else -2.0},
                "max_drawdown_pct": {"5d": -1.0 if idx % 2 == 0 else -0.5},
                "max_runup_pct": {"5d": 5.0 if idx % 2 == 0 else 0.4},
                "pending_horizons": [],
            }
        )

    first_payload = {
        "strategy": "dip_buyer",
        "market_regime": "confirmed_uptrend",
        "records": records[:15],
    }
    second_payload = {
        "strategy": "canslim",
        "market_regime": "correction",
        "records": records[15:],
    }
    (settled_dir / "20260301-dip_buyer.json").write_text(json.dumps(first_payload), encoding="utf-8")
    (settled_dir / "20260316-canslim.json").write_text(json.dumps(second_payload), encoding="utf-8")

    summary = build_prediction_accuracy_summary(root=tmp_path)

    assert {row["strategy"] for row in summary["by_strategy"]} == {"dip_buyer", "canslim"}
    assert {row["action"] for row in summary["by_action"]} == {"BUY", "NO_BUY"}
    assert summary["by_strategy_action"] == summary["summary"]
    assert summary["rolling_window_sizes"] == [20, 50, 100]
    assert summary["rolling_summary"]["20"]["records_considered"] == 20
    assert summary["rolling_summary"]["20"]["is_partial_window"] is False
    assert summary["rolling_summary"]["50"]["records_considered"] == 25
    assert summary["rolling_summary"]["50"]["is_partial_window"] is True
    assert any(row["strategy"] == "canslim" for row in summary["rolling_summary"]["20"]["by_strategy"])
    assert any(row["confidence_bucket"] == "high" for row in summary["by_confidence_bucket"])
