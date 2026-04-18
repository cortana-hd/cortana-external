from __future__ import annotations

import json
from datetime import UTC, datetime

from evaluation.strategy_scorecard import build_strategy_scorecard_artifact


def test_strategy_scorecard_registers_challenger_family_and_writes_shadow_artifact(tmp_path):
    root = tmp_path / "prediction_accuracy"
    artifact = build_strategy_scorecard_artifact(
        [
            {
                "strategy": "canslim",
                "action": "BUY",
                "predicted_at": datetime(2026, 4, 10, 12, 0, tzinfo=UTC).isoformat(),
                "market_regime": "confirmed_uptrend",
                "forward_return_5d_pct": 2.5,
                "opportunity_score": 76.0,
                "score": 9.0,
                "downside_risk": 0.28,
                "calibrated_confidence": 0.67,
            },
            {
                "strategy": "dip_buyer",
                "action": "WATCH",
                "predicted_at": datetime(2026, 4, 10, 12, 0, tzinfo=UTC).isoformat(),
                "market_regime": "correction",
                "forward_return_5d_pct": -1.5,
                "opportunity_score": 48.0,
                "score": 6.0,
                "downside_risk": 0.42,
                "calibrated_confidence": 0.51,
            },
        ],
        root=root,
    )

    assert artifact["artifact_family"] == "strategy_scorecard_summary"
    rows = artifact["strategies"]
    assert {row["strategy_family"] for row in rows} == {"canslim", "dip_buyer", "regime_momentum_rs"}
    challenger = next(row for row in rows if row["strategy_family"] == "regime_momentum_rs")
    assert challenger["health_status"] == "warming"

    shadow_path = root / "reports" / "opportunity-shadow-latest.json"
    assert shadow_path.exists()
    shadow_payload = json.loads(shadow_path.read_text(encoding="utf-8"))
    assert shadow_payload["artifact_family"] == "opportunity_shadow_summary"
