from __future__ import annotations

from lifecycle.entry_plan import build_entry_plan_from_signal
from lifecycle.execution_policy import build_execution_policy
from lifecycle.exit_engine import evaluate_exit_decision
from lifecycle.ledgers import LifecycleLedgerStore
from lifecycle.trade_objects import ClosedPosition, LifecycleStateError, OpenPosition


def test_entry_plan_builder_emits_buy_and_watch_preview_variants():
    buy_plan = build_entry_plan_from_signal(
        strategy="canslim",
        signal={
            "symbol": "MSFT",
            "action": "BUY",
            "reason": "Strong setup",
            "price": 100.0,
            "risk": "low",
            "trade_quality_score": 82.0,
            "effective_confidence": 76.0,
            "execution_policy_ref": "execution.good",
            "entry_plan_ref": "canslim.breakout_entry_v1",
            "data_source": "schwab",
            "data_staleness_seconds": 14.0,
        },
        market={"status": "ok"},
        overlays={"risk": {"state": "open"}},
        generated_at="2026-04-03T20:00:00+00:00",
    )
    watch_plan = build_entry_plan_from_signal(
        strategy="dip_buyer",
        signal={
            "symbol": "NVDA",
            "action": "WATCH",
            "reason": "Needs confirmation",
            "price": 200.0,
            "risk": "medium",
            "trade_quality_score": 70.0,
            "effective_confidence": 61.0,
            "execution_policy_ref": "execution.moderate",
            "entry_plan_ref": "dip_buyer.reversal_watch_v1",
            "data_source": "schwab",
            "data_staleness_seconds": 0.0,
        },
        market={"status": "ok"},
        overlays={"risk": {"state": "tight"}},
        generated_at="2026-04-03T20:00:00+00:00",
    )

    assert buy_plan is not None
    assert buy_plan.action_context == "BUY"
    assert buy_plan.executable is True
    assert buy_plan.preview_only is False
    assert watch_plan is not None
    assert watch_plan.action_context == "WATCH_PREVIEW"
    assert watch_plan.executable is False
    assert watch_plan.preview_only is True


def test_entry_plan_builder_suppresses_degraded_risky_inputs():
    plan = build_entry_plan_from_signal(
        strategy="canslim",
        signal={
            "symbol": "MSFT",
            "action": "BUY",
            "reason": "Strong setup",
            "price": 100.0,
            "data_source": "unknown",
            "data_staleness_seconds": 9999.0,
        },
        market={"status": "degraded_risky"},
        generated_at="2026-04-03T20:00:00+00:00",
    )
    assert plan is None


def test_lifecycle_ledgers_preserve_open_to_closed_lineage(tmp_path):
    store = LifecycleLedgerStore(root=tmp_path)
    open_position = OpenPosition(
        id="open-1",
        position_key="pos-1",
        schema_version="lifecycle.v1",
        symbol="MSFT",
        strategy="canslim",
        entered_at="2026-04-03T20:00:00+00:00",
        entry_price=100.0,
        entry_plan_ref="canslim:MSFT:plan",
        execution_policy_ref="execution.good",
    )
    store.append_open_position(open_position)

    closed_position = ClosedPosition(
        id="closed-1",
        position_key="pos-1",
        schema_version="lifecycle.v1",
        symbol="MSFT",
        strategy="canslim",
        entered_at="2026-04-03T20:00:00+00:00",
        exited_at="2026-04-05T20:00:00+00:00",
        entry_price=100.0,
        exit_price=108.0,
        exit_reason="target_hit",
        entry_plan_ref="canslim:MSFT:plan",
        execution_policy_ref="execution.good",
    )
    store.close_position(closed_position)

    assert store.load_open_positions() == []
    loaded_closed = store.load_closed_positions()
    assert len(loaded_closed) == 1
    assert loaded_closed[0].position_key == "pos-1"
    assert loaded_closed[0].entry_plan_ref == "canslim:MSFT:plan"


def test_lifecycle_ledgers_reject_invalid_state_transitions(tmp_path):
    store = LifecycleLedgerStore(root=tmp_path)
    try:
        store.close_position(
            ClosedPosition(
                id="closed-1",
                position_key="missing",
                schema_version="lifecycle.v1",
                symbol="MSFT",
                strategy="canslim",
                entered_at="2026-04-03T20:00:00+00:00",
                exited_at="2026-04-05T20:00:00+00:00",
                entry_price=100.0,
                exit_price=108.0,
            )
        )
    except LifecycleStateError as error:
        assert "No open position exists" in str(error)
    else:
        raise AssertionError("Closing a missing open position should fail")


def test_execution_policy_blocks_gap_above_zone_and_carries_fill_realism():
    policy = build_execution_policy(
        strategy="canslim",
        signal={
            "symbol": "MSFT",
            "action": "BUY",
            "price": 105.0,
        },
        entry_plan={
            "do_not_chase_above": 103.0,
        },
        overlays={
            "execution": {
                "estimated_slippage_bps": 42.0,
                "execution_quality": "moderate",
            },
            "risk": {
                "state": "balanced",
            },
        },
        generated_at="2026-04-03T20:00:00+00:00",
    )

    assert policy.fill_allowed is False
    assert policy.blocked_reason == "gap_above_zone"
    assert policy.fill_realism_state == "blocked"
    assert policy.expected_fill_fraction == 0.5


def test_exit_engine_marks_stop_hits_and_signal_downgrades():
    position = OpenPosition(
        id="open-1",
        position_key="pos-1",
        schema_version="lifecycle.v1",
        symbol="MSFT",
        strategy="canslim",
        entered_at="2026-04-01T20:00:00+00:00",
        entry_price=100.0,
        stop_price=95.0,
        target_price_1=108.0,
    )

    stop_decision = evaluate_exit_decision(
        position=position,
        reviewed_at="2026-04-03T20:00:00+00:00",
        current_price=94.5,
        signal={"action": "BUY"},
    )
    downgrade_decision = evaluate_exit_decision(
        position=position,
        reviewed_at="2026-04-03T20:00:00+00:00",
        current_price=101.0,
        signal={"action": "NO_BUY"},
    )

    assert stop_decision.reason == "stop_hit"
    assert downgrade_decision.reason == "signal_downgrade"
