from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from data.leader_baskets import build_leader_baskets, load_leader_priority_symbols, persist_leader_snapshot


def test_build_leader_baskets_aggregates_daily_weekly_monthly_history(tmp_path):
    persist_leader_snapshot(
        leaders=[
            {"symbol": "NVDA", "price": 100.0, "action": "BUY", "rank_score": 15.0, "confidence": 80},
            {"symbol": "AMD", "price": 90.0, "action": "WATCH", "rank_score": 12.0, "confidence": 65},
        ],
        generated_at="2026-03-19T21:00:00+00:00",
        market_regime="confirmed_uptrend",
        universe_size=500,
        root=tmp_path,
    )
    persist_leader_snapshot(
        leaders=[
            {"symbol": "NVDA", "price": 105.0, "action": "BUY", "rank_score": 16.0, "confidence": 82},
            {"symbol": "MSFT", "price": 200.0, "action": "WATCH", "rank_score": 11.0, "confidence": 60},
        ],
        generated_at="2026-03-20T21:00:00+00:00",
        market_regime="confirmed_uptrend",
        universe_size=500,
        root=tmp_path,
    )

    artifact, path = build_leader_baskets(root=tmp_path, generated_at="2026-03-20T21:00:00+00:00")

    assert path.exists()
    assert artifact["buckets"]["daily"][0]["symbol"] == "NVDA"
    assert artifact["buckets"]["daily"][1]["symbol"] == "MSFT"
    weekly = {item["symbol"]: item for item in artifact["buckets"]["weekly"]}
    monthly = {item["symbol"]: item for item in artifact["buckets"]["monthly"]}
    assert weekly["NVDA"]["appearances"] == 2
    assert monthly["NVDA"]["appearances"] == 2
    assert weekly["NVDA"]["window_return_pct"] == 5.0
    assert artifact["priority"]["symbols"][0] == "NVDA"
    assert "AMD" in artifact["priority"]["symbols"]
    assert (tmp_path / "daily.txt").read_text(encoding="utf-8").splitlines() == ["NVDA +5.0% (1x)", "MSFT n/a (1x)"]
    assert (tmp_path / "weekly.txt").read_text(encoding="utf-8").splitlines()[:2] == ["NVDA +5.0% (2x)", "AMD n/a (1x)"]


def test_load_leader_priority_symbols_respects_artifact_age(tmp_path):
    generated_at = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    artifact_path = Path(tmp_path) / "leader-baskets-latest.json"
    artifact_path.write_text(
        json.dumps(
            {
                "generated_at": generated_at,
                "priority": {"symbols": ["NVDA", "AMD", "MSFT"]},
            }
        ),
        encoding="utf-8",
    )

    fresh = load_leader_priority_symbols(path=artifact_path, max_age_hours=48)
    stale = load_leader_priority_symbols(path=artifact_path, max_age_hours=1)
    weekly = load_leader_priority_symbols(path=artifact_path, max_age_hours=48, bucket="weekly")

    assert fresh == ["NVDA", "AMD", "MSFT"]
    assert stale == []
    assert weekly == []
