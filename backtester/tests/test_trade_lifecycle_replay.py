from __future__ import annotations

import json
from pathlib import Path

from lifecycle.execution_policy import build_execution_policy
from lifecycle.exit_engine import evaluate_exit_decision
from lifecycle.paper_portfolio import select_entries
from lifecycle.trade_objects import OpenPosition
from trade_lifecycle_cycle import run_cycle


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "trade_lifecycle_replays.json"


def _fixture() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def test_replay_same_bar_gap_above_zone_blocks_fill():
    case = _fixture()["same_bar_gap_above_zone"]
    policy = build_execution_policy(
        strategy=case["signal"]["strategy"],
        signal=case["signal"],
        entry_plan=case["signal"]["entry_plan"],
        overlays=case["overlays"],
        generated_at="2026-04-03T20:00:00+00:00",
    )

    assert policy.fill_allowed is False
    assert policy.blocked_reason == "gap_above_zone"


def test_replay_gap_through_stop_closes_position():
    case = _fixture()["gap_through_stop_review"]
    position = OpenPosition.from_dict(case["open_position"])
    decision = evaluate_exit_decision(
        position=position,
        reviewed_at="2026-04-03T20:00:00+00:00",
        current_price=case["signal"]["price"],
        signal=case["signal"],
    )

    assert decision.reason == "stop_hit"


def test_replay_duplicate_entries_only_open_once(tmp_path):
    fixture = _fixture()["duplicate_entry_conflict"]
    alert_path = tmp_path / "alerts.json"
    alert_path.write_text(
        json.dumps(
            {
                "strategy": "canslim",
                "market": {"label": "confirmed_uptrend", "status": "ok"},
                "overlays": {
                    "risk": {"state": "open", "budget_fraction": 1.0},
                    "execution": {"estimated_slippage_bps": 10.0, "execution_quality": "good"},
                },
                "signals": [fixture["first_signal"], fixture["second_signal"]],
            }
        ),
        encoding="utf-8",
    )

    summary = run_cycle(
        alert_paths=[alert_path],
        root=tmp_path / "ledger",
        generated_at="2026-04-03T20:00:00+00:00",
    )

    assert summary["summary"]["opened_count"] == 1
    assert len(summary["open_positions"]) == 1


def test_replay_concentration_conflict_blocks_when_capacity_is_spent():
    candidates = [
        {"symbol": f"SYM{i}", "strategy": "canslim", "capital_fraction": 0.10}
        for i in range(6)
    ]
    selected, snapshot = select_entries(
        candidates=candidates,
        open_positions=[],
        closed_positions=[],
        snapshot_at="2026-04-03T20:00:00+00:00",
    )

    assert len(selected) == 3
    blocked_reasons = {item["block_reason"] for item in snapshot.blocked_candidates}
    assert "strategy_cap_reached" in blocked_reasons or "portfolio_capacity_reached" in blocked_reasons
