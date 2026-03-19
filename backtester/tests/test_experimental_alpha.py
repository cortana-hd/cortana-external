from datetime import UTC, datetime
from types import SimpleNamespace

import pandas as pd

from experimental_alpha import (
    AlphaCandidate,
    build_alpha_report,
    build_calibration_report,
    classify_paper_action,
    default_research_symbols,
    derive_alpha_candidate,
    expected_move_bps_for_candidate,
    format_alpha_report,
    load_alpha_snapshots,
    load_settled_alpha,
    persist_alpha_snapshot,
    settle_alpha_snapshots,
)


def test_derive_alpha_candidate_builds_positive_edge_for_supportive_actionable_setup():
    candidate = derive_alpha_candidate(
        {
            "symbol": "NVDA",
            "asset_class": "stock",
            "verdict": "actionable",
            "analysis": {
                "effective_confidence": 78,
                "recommendation": {"action": "BUY"},
            },
            "polymarket": {
                "conviction": "supportive",
                "divergence_state": "none",
                "matched": {"severity": "major", "persistence": "accelerating", "themes": ["rates"]},
            },
        }
    )

    assert candidate.paper_action == "paper_long"
    assert candidate.calibrated_prob > 0.57
    assert candidate.kelly_fraction > 0
    assert candidate.expected_move_bps >= 150


def test_derive_alpha_candidate_skips_persistent_conflict():
    candidate = derive_alpha_candidate(
        {
            "symbol": "BTC",
            "asset_class": "crypto",
            "verdict": "needs confirmation",
            "analysis": {
                "effective_confidence": 62,
                "recommendation": {"action": "WATCH"},
            },
            "polymarket": {
                "conviction": "conflicting",
                "divergence_state": "persistent",
                "matched": {"severity": "major", "persistence": "persistent", "themes": ["crypto-policy"]},
            },
        }
    )

    assert candidate.paper_action == "skip"
    assert candidate.edge < 0.05


def test_derive_alpha_candidate_captures_overlay_dimensions_for_research_logging():
    candidate = derive_alpha_candidate(
        {
            "symbol": "AAPL",
            "asset_class": "stock",
            "verdict": "needs confirmation",
            "analysis": {
                "effective_confidence": 67,
                "recommendation": {"action": "WATCH"},
                "risk_budget_overlay": {"state": "tight", "aggression_posture": "selective"},
                "execution_quality_overlay": {
                    "quality": "good",
                    "liquidity_tier": "tier1",
                    "spread_bps": 7.5,
                    "slippage_bps": 11.0,
                    "avg_dollar_volume": 45_000_000,
                },
            },
            "polymarket": {
                "conviction": "neutral",
                "aggression_dial": "lean_more_selective",
                "divergence_state": "none",
                "matched": {"severity": "minor", "persistence": "one_off"},
            },
        }
    )

    assert candidate.risk_budget_state == "tight"
    assert candidate.aggression_posture == "selective"
    assert candidate.execution_quality == "good"
    assert candidate.liquidity_tier == "tier1"
    assert candidate.spread_bps == 7.5
    assert candidate.slippage_bps == 11.0
    assert candidate.avg_dollar_volume_musd == 45.0
    assert "spread 7.5bp" in candidate.overlay_notes


def test_default_research_symbols_uses_structured_buckets(monkeypatch):
    monkeypatch.setattr(
        "experimental_alpha.load_structured_context",
        lambda: {
            "watchlistBuckets": {
                "stocks": [{"symbol": "NVDA"}, {"symbol": "AMD"}],
                "cryptoProxies": [{"symbol": "COIN"}],
                "crypto": [{"symbol": "BTC"}, {"symbol": "ETH"}],
            }
        },
    )

    assert default_research_symbols(limit_per_bucket=1) == ["NVDA", "COIN", "BTC"]


def test_build_alpha_report_orders_best_candidates_first():
    class _Advisor:
        def quick_check(self, symbol: str):
            if symbol == "NVDA":
                return {
                    "symbol": "NVDA",
                    "asset_class": "stock",
                    "verdict": "actionable",
                    "analysis": {"effective_confidence": 80, "recommendation": {"action": "BUY"}},
                    "polymarket": {
                        "conviction": "supportive",
                        "divergence_state": "none",
                        "matched": {"severity": "major", "persistence": "persistent", "themes": ["rates"]},
                    },
                }
            return {
                "symbol": "XLU",
                "asset_class": "stock",
                "verdict": "early / interesting",
                "analysis": {"effective_confidence": 55, "recommendation": {"action": "WATCH"}},
                "polymarket": {
                    "conviction": "neutral",
                    "divergence_state": "watch",
                    "matched": {"severity": "minor", "persistence": "one_off", "themes": ["recession"]},
                },
            }

    report = build_alpha_report(["XLU", "NVDA"], advisor=_Advisor())
    assert report[0].symbol == "NVDA"
    assert report[0].paper_action == "paper_long"


def test_helper_functions_remain_bounded():
    assert classify_paper_action("extended", 0.6, "supportive", "none") == "reduce_or_wait"
    assert expected_move_bps_for_candidate(
        asset_class="crypto", severity="major", persistence="accelerating", conviction="supportive"
    ) > expected_move_bps_for_candidate(
        asset_class="stock", severity="minor", persistence="one_off", conviction="neutral"
    )


def test_format_alpha_report_surfaces_overlay_dimensions_compactly():
    candidate = AlphaCandidate(
        symbol="NVDA",
        provider_symbol="NVDA",
        asset_class="stock",
        verdict="actionable",
        base_action="BUY",
        confidence_pct=75,
        conviction="supportive",
        divergence_state="none",
        severity="major",
        persistence="persistent",
        calibrated_prob=0.63,
        edge=0.13,
        kelly_fraction=0.08,
        expected_move_bps=160,
        paper_action="paper_long",
        entry_price=1000.0,
        rationale="test rationale",
        risk_budget_state="normal",
        aggression_posture="balanced",
        execution_quality="good",
        liquidity_tier="tier1",
        overlay_notes="spread 6.0bp; slip 10.0bp",
    )
    text = format_alpha_report([candidate])
    assert "overlay normal/balanced + good/tier1 (spread 6.0bp; slip 10.0bp)" in text


def test_persist_alpha_snapshot_round_trips_candidates(tmp_path):
    generated_at = datetime(2026, 3, 14, 12, 0, tzinfo=UTC)
    candidate = AlphaCandidate(
        symbol="NVDA",
        provider_symbol="NVDA",
        asset_class="stock",
        verdict="actionable",
        base_action="BUY",
        confidence_pct=78,
        conviction="supportive",
        divergence_state="none",
        severity="major",
        persistence="accelerating",
        calibrated_prob=0.642,
        edge=0.142,
        kelly_fraction=0.08,
        expected_move_bps=160,
        paper_action="paper_long",
        entry_price=920.0,
        rationale="actionable; conviction supportive; divergence none; signal major; persistence accelerating",
    )

    file_path = persist_alpha_snapshot([candidate], generated_at=generated_at, root=tmp_path)
    snapshots = load_alpha_snapshots(tmp_path)

    assert file_path.exists()
    assert len(snapshots) == 1
    assert snapshots[0].generated_at == generated_at.isoformat()
    assert snapshots[0].candidates[0].provider_symbol == "NVDA"
    assert (tmp_path / "snapshots" / "latest.json").exists()


def test_settle_alpha_snapshots_persists_forward_returns(tmp_path):
    generated_at = datetime(2026, 1, 5, 0, 0, tzinfo=UTC)
    candidate = AlphaCandidate(
        symbol="NVDA",
        provider_symbol="NVDA",
        asset_class="stock",
        verdict="actionable",
        base_action="BUY",
        confidence_pct=75,
        conviction="supportive",
        divergence_state="none",
        severity="major",
        persistence="persistent",
        calibrated_prob=0.62,
        edge=0.12,
        kelly_fraction=0.08,
        expected_move_bps=140,
        paper_action="paper_long",
        entry_price=100.0,
        rationale="test candidate",
    )
    persist_alpha_snapshot([candidate], generated_at=generated_at, root=tmp_path)

    frame = pd.DataFrame(
        {
            "Open": [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110],
            "High": [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110],
            "Low": [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110],
            "Close": [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110],
            "Volume": [1_000_000] * 11,
        },
        index=pd.date_range("2026-01-05", periods=11, freq="D", tz="UTC"),
    )

    class _MarketData:
        def get_history(self, symbol: str, period: str = "2y", auto_adjust: bool = False):
            assert symbol == "NVDA"
            return SimpleNamespace(frame=frame)

    settled = settle_alpha_snapshots(
        root=tmp_path,
        now=datetime(2026, 1, 20, 0, 0, tzinfo=UTC),
        market_data=_MarketData(),
    )
    loaded = load_settled_alpha(tmp_path)

    assert len(settled) == 1
    assert settled[0].forward_returns["5d"] == 0.05
    assert settled[0].forward_returns["10d"] == 0.1
    assert settled[0].realized_label == "validated_long"
    assert loaded[0].symbol == "NVDA"
    assert loaded[0].risk_budget_state == "unknown"
    assert (tmp_path / "settled" / "latest.json").exists()


def test_build_calibration_report_blocks_when_sample_quality_is_weak():
    records = [
        SimpleNamespace(
            paper_action="paper_long",
            calibrated_prob=0.61,
            forward_returns={"5d": 0.015, "10d": 0.008},
        ),
        SimpleNamespace(
            paper_action="paper_long",
            calibrated_prob=0.64,
            forward_returns={"5d": -0.03, "10d": -0.015},
        ),
    ]

    report = build_calibration_report(records, generated_at=datetime(2026, 3, 14, 12, 0, tzinfo=UTC), minimum_samples=5)

    assert report.gate.status == "blocked"
    assert any("below minimum" in reason for reason in report.gate.reasons)
    assert any(item.action == "paper_long" for item in report.by_action)


def test_build_calibration_report_can_clear_promotion_gate_with_enough_quality_samples():
    records = [
        SimpleNamespace(
            paper_action="paper_long",
            calibrated_prob=0.62,
            forward_returns={"5d": 0.03, "10d": 0.05},
        ),
        SimpleNamespace(
            paper_action="paper_long",
            calibrated_prob=0.64,
            forward_returns={"5d": 0.025, "10d": 0.04},
        ),
        SimpleNamespace(
            paper_action="paper_long",
            calibrated_prob=0.61,
            forward_returns={"5d": 0.04, "10d": 0.06},
        ),
    ]

    report = build_calibration_report(records, generated_at=datetime(2026, 3, 14, 12, 0, tzinfo=UTC), minimum_samples=3)

    assert report.gate.status == "ready"
    assert report.gate.paper_long_count == 3
    assert report.gate.paper_long_hit_rate_5d is not None
    assert report.gate.paper_long_avg_return_5d is not None


def test_build_calibration_report_includes_overlay_slice_metrics():
    records = [
        SimpleNamespace(
            paper_action="paper_long",
            calibrated_prob=0.62,
            risk_budget_state="tight",
            aggression_posture="selective",
            execution_quality="good",
            liquidity_tier="tier1",
            forward_returns={"5d": 0.03, "10d": 0.05},
        ),
        SimpleNamespace(
            paper_action="paper_long",
            calibrated_prob=0.59,
            risk_budget_state="tight",
            aggression_posture="selective",
            execution_quality="good",
            liquidity_tier="tier1",
            forward_returns={"5d": -0.01, "10d": 0.01},
        ),
    ]

    report = build_calibration_report(records, generated_at=datetime(2026, 3, 14, 12, 0, tzinfo=UTC), minimum_samples=2)
    buckets = {(item.dimension, item.bucket): item for item in report.overlay_slices}

    assert ("risk_budget_state", "tight") in buckets
    assert ("aggression_posture", "selective") in buckets
    assert ("execution_quality", "good") in buckets
    assert ("liquidity_tier", "tier1") in buckets
    assert buckets[("risk_budget_state", "tight")].count == 2
    assert buckets[("risk_budget_state", "tight")].matured_count == 2
