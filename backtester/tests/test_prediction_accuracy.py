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
        records=[{"symbol": "AAPL", "action": "WATCH", "score": 8, "effective_confidence": 61, "uncertainty_pct": 18, "trade_quality_score": 72, "reason": "test"}],
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
    assert record["market_regime"] == "correction"
    assert record["predicted_at"] == generated_at.isoformat()
    assert record["risk"] == "unknown"
    assert record["entry_plan_ref"] is None
    assert record["execution_policy_ref"] is None
    assert record["vetoes"] == []

    settle_prediction_snapshots(root=tmp_path, provider=_StubProvider(), now=generated_at + timedelta(days=30))
    summary = build_prediction_accuracy_summary(root=tmp_path)

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


def test_prediction_accuracy_uses_action_aware_avoidance_rate_for_no_buy(tmp_path):
    generated_at = datetime(2026, 3, 1, tzinfo=timezone.utc)
    persist_prediction_snapshot(
        strategy="canslim",
        market_regime="correction",
        records=[{"symbol": "MSFT", "action": "NO_BUY", "score": 6, "effective_confidence": 29, "reason": "test"}],
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


def test_prediction_snapshot_contract_requires_reason(tmp_path):
    generated_at = datetime(2026, 3, 1, tzinfo=timezone.utc)
    try:
        persist_prediction_snapshot(
            strategy="canslim",
            market_regime="correction",
            records=[{"symbol": "MSFT", "action": "BUY", "score": 8}],
            root=tmp_path,
            generated_at=generated_at,
            producer="backtester.test_prediction_accuracy",
        )
    except ValueError as error:
        assert "requires a reason" in str(error)
    else:
        raise AssertionError("persist_prediction_snapshot should reject records without a reason")
