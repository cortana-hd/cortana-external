from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from canslim_alert import format_alert as format_canslim
from canslim_alert import _load_priority_symbols as load_canslim_priority_symbols
from data.liquidity_overlay import build_execution_quality_overlay
from data.liquidity_model import LiquidityOverlayModel
from data.risk_budget import build_risk_budget_overlay
from data.universe_selection import UniverseSelectionResult
from data.market_regime import MarketRegime
from dipbuyer_alert import format_alert as format_dipbuyer
from dipbuyer_alert import _load_priority_symbols as load_dipbuyer_priority_symbols


@pytest.fixture(autouse=True)
def _disable_polymarket_artifacts(monkeypatch, tmp_path):
    monkeypatch.setenv("POLYMARKET_COMPACT_REPORT_PATH", str(tmp_path / "missing-compact.txt"))
    monkeypatch.setenv("POLYMARKET_REPORT_JSON_PATH", str(tmp_path / "missing-report.json"))
    monkeypatch.setenv("POLYMARKET_WATCHLIST_PATH", str(tmp_path / "missing-watchlist.json"))
    monkeypatch.setenv("BUY_DECISION_CALIBRATION_PATH", str(tmp_path / "missing-calibration.json"))
    monkeypatch.setenv("TRADING_INCLUDE_LEADER_BASKET_PRIORITY", "0")
    monkeypatch.setattr("canslim_alert._resolve_context_overlays", lambda **kwargs: ({}, {}))
    monkeypatch.setattr("dipbuyer_alert._resolve_context_overlays", lambda **kwargs: ({}, {}))


class _FakeCanSlimAdvisor:
    def __init__(self):
        self._market = SimpleNamespace(
            regime=MarketRegime.CORRECTION,
            position_sizing=0.0,
            notes="market correction gate",
            snapshot_age_seconds=0.0,
            status="ok",
        )
        self.screener = SimpleNamespace(get_universe=lambda: ["CFLT", "HWM", "ALUR", "SHOP"])
        self._analysis = {
            "CFLT": {"total_score": 7, "recommendation": {"action": "NO_BUY", "reason": "market correction gate"}},
            "HWM": {"total_score": 7, "recommendation": {"action": "NO_BUY", "reason": "market correction gate"}},
            "ALUR": {"total_score": 6, "recommendation": {"action": "NO_BUY", "reason": "market correction gate"}},
            "SHOP": {"total_score": 4, "recommendation": {"action": "NO_BUY", "reason": "below threshold"}},
        }

    def get_market_status(self, refresh: bool = False):
        return self._market

    def analyze_stock(self, symbol: str, *args):
        return self._analysis[symbol]


class _FakeDipBuyerAdvisor:
    def __init__(self):
        self.risk_fetcher = SimpleNamespace(get_snapshot=lambda: {})
        self._market = SimpleNamespace(
            regime=MarketRegime.CORRECTION,
            position_sizing=0.0,
            notes="market correction gate",
            snapshot_age_seconds=0.0,
            status="ok",
        )
        self.screener = SimpleNamespace(get_universe=lambda: ["CFLT", "HWM", "ALUR", "SHOP"])
        self._analysis = {
            "CFLT": {"total_score": 7, "recommendation": {"action": "NO_BUY", "reason": "market correction gate"}},
            "HWM": {"total_score": 7, "recommendation": {"action": "NO_BUY", "reason": "market correction gate"}},
            "ALUR": {"total_score": 6, "recommendation": {"action": "NO_BUY", "reason": "market correction gate"}},
            "SHOP": {"total_score": 4, "recommendation": {"action": "NO_BUY", "reason": "below threshold"}},
        }

    def get_market_status(self, refresh: bool = False):
        return self._market

    def analyze_dip_stock(self, symbol: str, *args):
        return self._analysis[symbol]


def test_canslim_alert_is_compact_when_market_gate_blocks_buys():
    with patch("canslim_alert.TradingAdvisor", return_value=_FakeCanSlimAdvisor()), patch.dict("os.environ", {"TRADING_INCLUDE_WATCHLIST_PRIORITY": "0"}):
        text = format_canslim(limit=5, min_score=6, universe_size=4)

    assert text.splitlines() == [
        "CANSLIM Scan",
        "Market: correction — no new positions",
        "Alert posture: stand aside — correction regime. This is a status update, not a buy-now alert.",
        "Scanned 4 | market gate active | 0 BUY | 0 WATCH",
        "Top names considered: CFLT, HWM, ALUR",
        "Why no buys: market correction gate",
    ]


def test_priority_symbols_prefer_explicit_then_leader_baskets_then_bounded_watchlist(monkeypatch):
    monkeypatch.setenv("TRADING_PRIORITY_SYMBOLS", "TSLA")
    monkeypatch.delenv("TRADING_PRIORITY_FILE", raising=False)
    monkeypatch.setenv("TRADING_WATCHLIST_PRIORITY_LIMIT", "2")
    monkeypatch.setenv("TRADING_INCLUDE_LEADER_BASKET_PRIORITY", "1")
    monkeypatch.setattr("canslim_alert.load_leader_priority_symbols", lambda: ["AMD", "NVDA"])
    monkeypatch.setattr("dipbuyer_alert.load_leader_priority_symbols", lambda: ["AMD", "NVDA"])

    canslim_priority = load_canslim_priority_symbols()
    dipbuyer_priority = load_dipbuyer_priority_symbols()

    assert canslim_priority == ["TSLA", "AMD", "NVDA"]
    assert dipbuyer_priority == ["TSLA", "AMD", "NVDA"]
    assert len(canslim_priority) == len(set(canslim_priority))
    assert len(dipbuyer_priority) == len(set(dipbuyer_priority))


def test_canslim_alert_timing_line_surfaces_phase_and_nested_timings():
    fake = _FakeCanSlimAdvisor()
    fake._market = SimpleNamespace(
        regime=MarketRegime.CONFIRMED_UPTREND,
        position_sizing=1.0,
        notes="trend intact",
        snapshot_age_seconds=0.0,
        status="ok",
    )
    fake.screener = SimpleNamespace(get_universe=lambda: ["AAA"])
    fake._analysis = {
        "AAA": {
            "total_score": 8,
            "data_source": "schwab",
            "data_staleness_seconds": 12.0,
            "timing": {"history": 0.8, "fundamentals": 0.2, "sector": 0.4},
            "recommendation": {"action": "WATCH", "reason": "watch", "trade_quality_score": 80.0},
        }
    }

    with patch("canslim_alert.TradingAdvisor", return_value=fake), patch.dict(
        "os.environ",
        {"TRADING_INCLUDE_WATCHLIST_PRIORITY": "0", "BACKTESTER_TIMING": "1"},
    ):
        text = format_canslim(limit=5, min_score=6, universe_size=1)

    assert "Timing:" in text
    assert "market" in text
    assert "universe" in text
    assert "analysis" in text
    assert "slowest nested: history 0.80s" in text


def test_canslim_alert_surfaces_compact_overlay_annotations_when_available():
    fake = _FakeCanSlimAdvisor()
    risk_overlay = {
        "risk_budget_remaining": 0.42,
        "aggression_dial": "lean_defensive",
        "exposure_cap_hint": 0.58,
        "reasons": ["market inputs stale"],
    }
    execution_overlay = {
        "execution_quality": "moderate",
        "liquidity_posture": "adequate",
        "slippage_risk": "medium",
    }

    with patch("canslim_alert.TradingAdvisor", return_value=fake), patch(
        "canslim_alert._resolve_context_overlays",
        return_value=(risk_overlay, execution_overlay),
    ), patch.dict("os.environ", {"TRADING_INCLUDE_WATCHLIST_PRIORITY": "0"}):
        text = format_canslim(limit=5, min_score=6, universe_size=4)

    assert "Risk budget: remaining 42% | cap 58% | aggression lean defensive | note market inputs stale" in text
    assert "Execution quality: quality moderate | liquidity adequate | slippage medium" in text


def test_canslim_alert_surfaces_real_risk_and_liquidity_helper_lines(tmp_path, monkeypatch):
    liquidity_path = tmp_path / "liquidity-overlay.json"
    model = LiquidityOverlayModel(cache_path=liquidity_path)
    closes = [100 + i * 0.2 for i in range(120)]
    histories = {
        "MSFT": pd.DataFrame(
            {
                "Open": closes,
                "High": [value * 1.01 for value in closes],
                "Low": [value * 0.99 for value in closes],
                "Close": closes,
                "Volume": [50_000_000.0] * 120,
            },
            index=pd.date_range("2025-01-01", periods=120, freq="B", tz="UTC"),
        )
    }
    model.refresh_cache(base_symbols=["MSFT"], histories=histories)
    monkeypatch.setenv("TRADING_LIQUIDITY_OVERLAY_PATH", str(liquidity_path))

    risk_overlay = build_risk_budget_overlay(
        market=SimpleNamespace(
            regime=MarketRegime.CONFIRMED_UPTREND,
            position_sizing=1.0,
            notes="trend intact",
            snapshot_age_seconds=0.0,
            status="ok",
        )
    ).to_dict()
    execution_overlay = build_execution_quality_overlay(symbol="MSFT")

    from canslim_alert import _execution_quality_line, _risk_budget_line

    assert "Risk budget:" in _risk_budget_line(risk_overlay)
    assert "Execution quality: quality good | liquidity high | slippage high" in _execution_quality_line(execution_overlay)


def test_dipbuyer_alert_is_compact_when_market_gate_blocks_buys():
    analyzer = MagicMock()
    with patch("dipbuyer_alert.TradingAdvisor", return_value=_FakeDipBuyerAdvisor()), patch(
        "dipbuyer_alert.XSentimentAnalyzer", return_value=analyzer
    ), patch.dict("os.environ", {"TRADING_INCLUDE_WATCHLIST_PRIORITY": "0"}):
        text = format_dipbuyer(limit=5, min_score=6, universe_size=4)

    assert text.splitlines() == [
        "Dip Buyer Scan",
        "Market regime: correction",
        "Alert posture: stand aside — correction regime. This is a status update, not a buy-now alert.",
        "Qualified setups: 3 of 4 scanned | BUY 0 | WATCH 0",
        "BUY names: none",
        "Top leaders: CFLT NO_BUY (7/12) | HWM NO_BUY (7/12) | ALUR NO_BUY (6/12)",
        "Decision review: BUY 0 | WATCH 0 | NO_BUY 3",
        "Tuning balance: clean BUY 0 | risky BUY proxy 0 | abstain 0 | veto 3 | higher-tq restraint proxy n/a",
        "Vetoes: CFLT NO_BUY | tq 7.0 | conf 0% u 0% | down/churn 0.0/0.0 | stress normal(0) | veto market-gate | reason market correction gate; HWM NO_BUY | tq 7.0 | conf 0% u 0% | down/churn 0.0/0.0 | stress normal(0) | veto market-gate | reason market correction gate (+1 more)",
        "Final action: DO NOT BUY — market regime veto (market correction gate)",
    ]
    analyzer.analyze.assert_not_called()


def test_dipbuyer_alert_can_expand_review_details_for_local_runs():
    analyzer = MagicMock()
    fake = _FakeDipBuyerAdvisor()
    fake._analysis = {
        "CFLT": {"total_score": 7, "recommendation": {"action": "NO_BUY", "reason": "market correction gate"}},
        "HWM": {"total_score": 7, "recommendation": {"action": "NO_BUY", "reason": "market correction gate"}},
        "ALUR": {"total_score": 6, "recommendation": {"action": "NO_BUY", "reason": "market correction gate"}},
        "SHOP": {"total_score": 6, "recommendation": {"action": "NO_BUY", "reason": "market correction gate"}},
    }

    with patch("dipbuyer_alert.TradingAdvisor", return_value=fake), patch(
        "dipbuyer_alert.XSentimentAnalyzer", return_value=analyzer
    ), patch.dict("os.environ", {"TRADING_INCLUDE_WATCHLIST_PRIORITY": "0"}):
        text = format_dipbuyer(limit=5, min_score=6, universe_size=4, review_detail_limit=5)

    assert "Vetoes:" in text
    assert "(+1 more)" not in text
    assert "SHOP NO_BUY" in text


def test_dipbuyer_alert_downgrades_buys_to_watch_in_correction_mode():
    analyzer = MagicMock()
    fake = _FakeDipBuyerAdvisor()
    fake._analysis = {
        "CFLT": {"total_score": 9, "recommendation": {"action": "BUY", "reason": "clean"}},
        "HWM": {"total_score": 8, "recommendation": {"action": "BUY", "reason": "clean"}},
        "ALUR": {"total_score": 7, "recommendation": {"action": "WATCH", "reason": "early"}},
        "SHOP": {"total_score": 4, "recommendation": {"action": "NO_BUY", "reason": "below threshold"}},
    }

    with patch("dipbuyer_alert.TradingAdvisor", return_value=fake), patch(
        "dipbuyer_alert.XSentimentAnalyzer", return_value=analyzer
    ), patch.dict("os.environ", {"TRADING_INCLUDE_WATCHLIST_PRIORITY": "0"}):
        text = format_dipbuyer(limit=5, min_score=6, universe_size=4, review_detail_limit=5)

    assert "Alert posture: review only — correction regime. Treat surfaced names as a watchlist, not a buy-now alert." in text
    assert "Qualified setups: 3 of 4 scanned | BUY 0 | WATCH 3" in text
    assert "Watch names (regime-blocked buys): CFLT, HWM, ALUR" in text
    assert "Top leaders: CFLT WATCH (9/12) | HWM WATCH (8/12) | ALUR WATCH (7/12)" in text
    assert "Final action: WATCH only — correction regime blocks new dip buys" in text


def test_alerts_surface_uncalibrated_confidence_note_when_no_settled_records(tmp_path, monkeypatch):
    calibration_path = tmp_path / "buy-decision-calibration.json"
    calibration_path.write_text(
        '{"freshness":{"is_stale":true,"reason":"no_settled_records"},"summary":{"settled_candidates":0}}',
        encoding="utf-8",
    )
    monkeypatch.setenv("BUY_DECISION_CALIBRATION_PATH", str(calibration_path))
    fake = _FakeCanSlimAdvisor()

    with patch("canslim_alert.TradingAdvisor", return_value=fake), patch.dict("os.environ", {"TRADING_INCLUDE_WATCHLIST_PRIORITY": "0"}):
        text = format_canslim(limit=5, min_score=6, universe_size=4)

    assert (
        "Calibration note: uncalibrated — no settled outcomes yet, so confidence is still model-estimated rather than proven."
        in text
    )


def test_canslim_alert_uses_trade_quality_order_for_leaders():
    fake = _FakeCanSlimAdvisor()
    fake._market = SimpleNamespace(
        regime=MarketRegime.CONFIRMED_UPTREND,
        position_sizing=1.0,
        notes="trend intact",
        snapshot_age_seconds=0.0,
        status="ok",
    )
    fake.screener = SimpleNamespace(get_universe=lambda: ["AAA", "BBB"])
    fake._analysis = {
        "AAA": {
            "total_score": 9,
            "trade_quality_score": 71.0,
            "effective_confidence": 52,
            "uncertainty_pct": 31,
            "abstain": True,
            "abstain_reasons": ["data coverage thin", "adverse regime elevated"],
            "recommendation": {
                "action": "WATCH",
                "reason": "uncertain",
                "trade_quality_score": 71.0,
                "abstain": True,
                "abstain_reasons": ["data coverage thin", "adverse regime elevated"],
            },
        },
        "BBB": {
            "total_score": 8,
            "trade_quality_score": 94.0,
            "effective_confidence": 80,
            "uncertainty_pct": 8,
            "downside_penalty": 2.0,
            "churn_penalty": 1.0,
            "abstain": False,
            "recommendation": {
                "action": "BUY",
                "reason": "clean",
                "trade_quality_score": 94.0,
                "effective_confidence": 80,
                "uncertainty_pct": 8,
                "downside_penalty": 2.0,
                "churn_penalty": 1.0,
                "abstain": False,
            },
        },
    }

    with patch("canslim_alert.TradingAdvisor", return_value=fake), patch.dict("os.environ", {"TRADING_INCLUDE_WATCHLIST_PRIORITY": "0"}):
        text = format_canslim(limit=5, min_score=6, universe_size=2)

    assert "Top names considered: BBB, AAA" in text
    assert "Leaders: BBB BUY (8/12) | AAA WATCH (9/12)" in text
    assert "Decision review: BUY 1 | WATCH 1 | NO_BUY 0" in text
    assert "Tuning balance: clean BUY 1 | risky BUY proxy 0 | abstain 1 | veto 0 | higher-tq restraint proxy 0 (>= median BUY tq 94.0)" in text
    assert "Good buys: BBB BUY | tq 94.0 | conf 80% u 8% | down/churn 2.0/1.0 | stress normal(0)" in text
    assert "Abstains: AAA WATCH | tq 71.0 | conf 52% u 31% | down/churn 0.0/0.0 | stress normal(0) | ABSTAIN | reasons data coverage thin | adverse regime elevated | reason uncertain" in text


def test_canslim_alert_review_surfaces_veto_and_restraint_proxies_compactly():
    fake = _FakeCanSlimAdvisor()
    fake._market = SimpleNamespace(
        regime=MarketRegime.CONFIRMED_UPTREND,
        position_sizing=1.0,
        notes="trend intact",
        snapshot_age_seconds=0.0,
        status="ok",
    )
    fake.screener = SimpleNamespace(get_universe=lambda: ["AAA", "BBB", "CCC"])
    fake._analysis = {
        "AAA": {
            "total_score": 8,
            "trade_quality_score": 88.0,
            "effective_confidence": 77,
            "uncertainty_pct": 9,
            "downside_penalty": 2.0,
            "churn_penalty": 1.0,
            "recommendation": {"action": "BUY", "reason": "clean", "trade_quality_score": 88.0},
        },
        "BBB": {
            "total_score": 9,
            "trade_quality_score": 90.0,
            "effective_confidence": 59,
            "uncertainty_pct": 12,
            "downside_penalty": 3.0,
            "churn_penalty": 2.0,
            "exit_risk": {"veto": True},
            "recommendation": {"action": "WATCH", "reason": "Exit risk too high", "trade_quality_score": 90.0},
        },
        "CCC": {
            "total_score": 8,
            "trade_quality_score": 83.0,
            "effective_confidence": 70,
            "uncertainty_pct": 8,
            "sentiment_overlay": {"veto": True},
            "recommendation": {"action": "WATCH", "reason": "Sentiment overlay veto: bearish", "trade_quality_score": 83.0},
        },
    }

    with patch("canslim_alert.TradingAdvisor", return_value=fake), patch.dict("os.environ", {"TRADING_INCLUDE_WATCHLIST_PRIORITY": "0"}):
        text = format_canslim(limit=5, min_score=6, universe_size=3)

    lines = text.splitlines()
    assert len(lines) <= 9
    assert "Tuning balance: clean BUY 1 | risky BUY proxy 0 | abstain 0 | veto 2 | higher-tq restraint proxy 1 (>= median BUY tq 88.0)" in text
    assert "Higher-tq restraint: BBB WATCH | tq 90.0 | conf 59% u 12% | down/churn 3.0/2.0 | stress normal(0) | reason Exit risk too high" in text
    assert "Vetoes: BBB WATCH | tq 90.0 | conf 59% u 12% | down/churn 3.0/2.0 | stress normal(0) | veto exit-risk | reason Exit risk too high; CCC WATCH | tq 83.0 | conf 70% u 8% | down/churn 0.0/0.0 | stress normal(0) | veto sentiment/reason-veto | reason Sentiment overlay veto: bearish" in text


def test_live_alerts_surface_ranked_universe_selection_when_prefilter_is_active():
    fake = _FakeCanSlimAdvisor()
    fake._market = SimpleNamespace(
        regime=MarketRegime.CONFIRMED_UPTREND,
        position_sizing=1.0,
        notes="trend intact",
        snapshot_age_seconds=0.0,
        status="ok",
    )
    fake.market_data = object()
    fake.screener = SimpleNamespace(get_universe=lambda: ["AAA", "BBB", "CCC"])
    fake._analysis = {
        "AAA": {"total_score": 8, "recommendation": {"action": "WATCH", "reason": "watch"}},
        "BBB": {"total_score": 9, "recommendation": {"action": "BUY", "reason": "buy"}},
    }
    selection = UniverseSelectionResult(
        symbols=["AAA", "BBB"],
        priority_symbols=["AAA"],
        ranked_symbols=["BBB"],
        unscored_symbols=["CCC"],
        base_universe_size=3,
        source="cache",
        generated_at="2026-03-14T09:00:00+00:00",
        cache_age_hours=1.0,
    )

    with patch("canslim_alert.TradingAdvisor", return_value=fake), patch(
        "canslim_alert.RankedUniverseSelector.select_live_universe",
        return_value=selection,
    ), patch.dict("os.environ", {"TRADING_INCLUDE_WATCHLIST_PRIORITY": "0"}):
        text = format_canslim(limit=5, min_score=6, universe_size=2)

    assert "Universe selection: 1 pinned | 1 ranked | source cache | cache age 1.0h" in text
