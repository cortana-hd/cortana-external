from lifecycle.trade_objects import OpenPosition
from portfolio.allocator import build_strategy_budget_allocations
from portfolio.posture import build_portfolio_posture_artifact
from portfolio.risk_budget import build_risk_budget_state


def test_strategy_budget_allocations_bound_low_trust_family():
    artifact = build_strategy_budget_allocations(
        candidates=[
            {"symbol": "NVDA", "strategy": "trusted_family", "opportunity_score": 82.0, "trade_quality_score": 78.0, "effective_confidence": 74.0},
            {"symbol": "MSFT", "strategy": "trusted_family", "opportunity_score": 79.0, "trade_quality_score": 77.0, "effective_confidence": 72.0},
            {"symbol": "ABNB", "strategy": "exploratory_family", "opportunity_score": 81.0, "trade_quality_score": 80.0, "effective_confidence": 75.0},
        ],
        authority_artifact={
            "families": [
                {"strategy_family": "trusted_family", "authority_tier": "trusted", "autonomy_mode": "supervised_live"},
                {"strategy_family": "exploratory_family", "authority_tier": "exploratory", "autonomy_mode": "advisory"},
            ]
        },
        total_capital=100_000.0,
    )

    budgets = {row["strategy_family"]: row for row in artifact["allocations"]}
    assert budgets["trusted_family"]["budget_amount"] > budgets["exploratory_family"]["budget_amount"]
    assert budgets["exploratory_family"]["candidate_slots"] <= 2


def test_risk_budget_drawdown_pause_reduces_posture():
    risk_state = build_risk_budget_state(
        total_capital=100_000.0,
        open_positions=[],
        portfolio_drawdown_pct=8.5,
    )

    assert risk_state["posture_state"] == "paused"
    assert risk_state["drawdown_state"]["allowed_gross_exposure_fraction"] == 0.0


def test_portfolio_posture_summarizes_allocations_and_overlap():
    open_positions = [
        OpenPosition(
            id="pos-1",
            position_key="pos-1",
            schema_version="lifecycle.v1",
            symbol="MSFT",
            strategy="trusted_family",
            entered_at="2026-04-10T13:30:00+00:00",
            entry_price=100.0,
            capital_allocated=10_000.0,
        )
    ]
    posture = build_portfolio_posture_artifact(
        snapshot_at="2026-04-18T14:00:00+00:00",
        total_capital=100_000.0,
        open_positions=open_positions,
        selected_candidates=[
            {"symbol": "NVDA", "strategy": "trusted_family", "capital_allocated": 12_000.0, "sector": "tech", "theme": "ai"},
            {"symbol": "AMD", "strategy": "trusted_family", "capital_allocated": 9_000.0, "sector": "tech", "theme": "ai"},
        ],
        budget_artifact={
            "allocations": [
                {
                    "strategy_family": "trusted_family",
                    "budget_amount": 30_000.0,
                    "candidate_slots": 2,
                    "autonomy_mode": "supervised_live",
                }
            ]
        },
        risk_budget_state={
            "posture_state": "selective",
            "drawdown_state": {"portfolio_drawdown_pct": 3.2},
            "warnings": ["drawdown_selective"],
        },
        authority_artifact={
            "families": [
                {
                    "strategy_family": "trusted_family",
                    "authority_tier": "trusted",
                    "autonomy_mode": "supervised_live",
                }
            ]
        },
    )

    assert posture["posture_state"] == "selective"
    assert posture["summary"]["top_strategy_family"] == "trusted_family"
    assert posture["overlap_summary"]["sector_overlap_count"] == 1
    assert "sector_overlap_detected" in posture["warnings"]
