from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from advisor import TradingAdvisor as _RealTradingAdvisor
from data.market_regime import MarketRegime
from evaluation.artifact_contracts import ARTIFACT_FAMILY_STRATEGY_ALERT, ARTIFACT_SCHEMA_VERSION

import canslim_alert
import dipbuyer_alert


class _FakeCanSlimAdvisor:
    build_prediction_contract_context = staticmethod(_RealTradingAdvisor.build_prediction_contract_context)
    _action_priority = staticmethod(_RealTradingAdvisor._action_priority)

    def __init__(self):
        self._market = SimpleNamespace(
            regime=MarketRegime.CONFIRMED_UPTREND,
            position_sizing=1.0,
            notes="trend intact",
            status="ok",
            data_source="schwab",
            snapshot_age_seconds=0.0,
        )
        self.screener = SimpleNamespace(get_universe=lambda: ["MSFT", "AAPL"])
        self._analysis = {
            "MSFT": {
                "total_score": 8,
                "data_source": "schwab",
                "data_staleness_seconds": 14.0,
                "price": 100.0,
                "recommendation": {
                    "action": "BUY",
                    "reason": "Strong setup",
                    "entry": 100.0,
                    "stop_loss": 93.0,
                    "trade_quality_score": 82.0,
                    "effective_confidence": 76.0,
                },
            },
            "AAPL": {
                "total_score": 5,
                "data_source": "cache",
                "data_staleness_seconds": 1800.0,
                "recommendation": {"action": "NO_BUY", "reason": "Below threshold"},
            },
        }

    def get_market_status(self, refresh: bool = False):
        return self._market

    def analyze_stock(self, symbol: str, *args):
        return self._analysis[symbol]


class _FakeDipBuyerAdvisor:
    build_prediction_contract_context = staticmethod(_RealTradingAdvisor.build_prediction_contract_context)
    _action_priority = staticmethod(_RealTradingAdvisor._action_priority)

    def __init__(self):
        self.risk_fetcher = SimpleNamespace(get_snapshot=lambda: {})
        self._market = SimpleNamespace(
            regime=MarketRegime.UPTREND_UNDER_PRESSURE,
            position_sizing=0.5,
            notes="stay selective",
            status="ok",
            data_source="schwab",
            snapshot_age_seconds=0.0,
        )
        self.screener = SimpleNamespace(get_universe=lambda: ["MSFT"])
        self._analysis = {
            "MSFT": {
                "total_score": 9,
                "data_source": "schwab",
                "data_staleness_seconds": 22.0,
                "price": 50.0,
                "recommendation": {
                    "action": "BUY",
                    "reason": "Strong rebound",
                    "entry": 50.0,
                    "stop_loss": 46.0,
                    "trade_quality_score": 79.0,
                    "effective_confidence": 73.0,
                },
            }
        }

    def get_market_status(self, refresh: bool = False):
        return self._market

    def analyze_dip_stock(self, symbol: str):
        return self._analysis[symbol]


def test_canslim_build_alert_payload_emits_strategy_artifact(monkeypatch):
    monkeypatch.setenv("TRADING_INCLUDE_LEADER_BASKET_PRIORITY", "0")
    monkeypatch.setenv("TRADING_INCLUDE_WATCHLIST_PRIORITY", "0")
    monkeypatch.setattr("canslim_alert._resolve_context_overlays", lambda **kwargs: ({}, {}))
    monkeypatch.setattr("canslim_alert.build_alert_context_lines", lambda watchlist: [])
    with patch("canslim_alert.TradingAdvisor", return_value=_FakeCanSlimAdvisor()):
        payload = canslim_alert.build_alert_payload(
            limit=5,
            min_score=6,
            universe_size=2,
            review_detail_limit=2,
        )

    assert payload["artifact_family"] == ARTIFACT_FAMILY_STRATEGY_ALERT
    assert payload["schema_version"] == ARTIFACT_SCHEMA_VERSION
    assert payload["producer"] == canslim_alert.CANSLIM_ALERT_PRODUCER
    assert payload["strategy"] == "canslim"
    assert payload["outcome_class"] == "healthy_candidates_found"
    assert payload["degraded_status"] == "healthy"
    assert payload["summary"]["scanned"] == 2
    assert payload["summary"]["threshold_passed"] == 1
    assert payload["inputs"]["source_counts"] == {"schwab": 1, "cache": 1}
    assert payload["signals"][0]["symbol"] == "MSFT"
    assert payload["signals"][0]["data_source"] == "schwab"
    assert payload["signals"][0]["entry_plan"]["action_context"] == "BUY"
    assert payload["signals"][0]["execution_policy"]["fill_allowed"] is True
    assert payload["signals"][0]["execution_policy_ref"]
    assert payload["entry_plans"][0]["entry_style"] == "breakout_buy_zone"
    assert payload["execution_policies"][0]["entry_order_type"] == "limit"
    assert payload["render_lines"][0] == "CANSLIM Scan"


def test_dipbuyer_build_alert_payload_emits_strategy_artifact(monkeypatch):
    monkeypatch.setenv("TRADING_INCLUDE_LEADER_BASKET_PRIORITY", "0")
    monkeypatch.setenv("TRADING_INCLUDE_WATCHLIST_PRIORITY", "0")
    monkeypatch.setattr("dipbuyer_alert._resolve_context_overlays", lambda **kwargs: ({}, {}))
    monkeypatch.setattr("dipbuyer_alert.build_alert_context_lines", lambda watchlist: [])
    monkeypatch.setattr(
        "dipbuyer_alert.build_intraday_breadth_snapshot",
        lambda: {"status": "inactive", "override_state": "inactive", "override_reason": "outside regular market session", "warnings": []},
    )
    analyzer = MagicMock()
    analyzer.analyze.return_value = {"sentiment": "NEUTRAL"}

    with patch("dipbuyer_alert.TradingAdvisor", return_value=_FakeDipBuyerAdvisor()), patch(
        "dipbuyer_alert.XSentimentAnalyzer", return_value=analyzer
    ):
        payload = dipbuyer_alert.build_alert_payload(limit=5, min_score=6, universe_size=1, review_detail_limit=2)

    assert payload["artifact_family"] == ARTIFACT_FAMILY_STRATEGY_ALERT
    assert payload["schema_version"] == ARTIFACT_SCHEMA_VERSION
    assert payload["producer"] == dipbuyer_alert.DIPBUYER_ALERT_PRODUCER
    assert payload["strategy"] == "dip_buyer"
    assert payload["outcome_class"] == "healthy_candidates_found"
    assert payload["degraded_status"] == "healthy"
    assert payload["summary"]["buy_count"] == 1
    assert payload["inputs"]["source_counts"] == {"schwab": 1}
    assert payload["overlays"]["breadth"]["override_state"] == "inactive"
    assert payload["signals"][0]["symbol"] == "MSFT"
    assert payload["signals"][0]["entry_plan"]["action_context"] == "BUY"
    assert payload["signals"][0]["execution_policy"]["fill_allowed"] is True
    assert payload["signals"][0]["execution_policy_ref"]
    assert payload["entry_plans"][0]["entry_style"] == "reversal_reclaim"
    assert payload["execution_policies"][0]["entry_order_type"] == "limit"
    assert payload["render_lines"][0] == "Dip Buyer Scan"


def test_canslim_main_emits_json_payload(monkeypatch, capsys, tmp_path):
    payload = {
        "artifact_family": ARTIFACT_FAMILY_STRATEGY_ALERT,
        "schema_version": ARTIFACT_SCHEMA_VERSION,
        "producer": canslim_alert.CANSLIM_ALERT_PRODUCER,
        "status": "ok",
        "degraded_status": "healthy",
        "generated_at": "2026-04-03T16:00:00+00:00",
        "known_at": "2026-04-03T16:00:00+00:00",
        "strategy": "canslim",
        "summary": {},
        "signals": [],
        "render_lines": ["CANSLIM Scan"],
    }
    output_path = tmp_path / "canslim.json"
    monkeypatch.setattr(
        canslim_alert.argparse.ArgumentParser,
        "parse_args",
        lambda self: SimpleNamespace(limit=8, min_score=6, universe_size=120, review_detail_limit=2, json=True, output_json=output_path),
    )
    monkeypatch.setattr(canslim_alert, "build_alert_payload", lambda **kwargs: payload)

    canslim_alert.main()

    rendered = json.loads(capsys.readouterr().out)
    assert rendered["producer"] == canslim_alert.CANSLIM_ALERT_PRODUCER
    assert rendered["strategy"] == "canslim"
    assert json.loads(output_path.read_text(encoding="utf-8"))["strategy"] == "canslim"


def test_dipbuyer_main_emits_json_payload(monkeypatch, capsys, tmp_path):
    payload = {
        "artifact_family": ARTIFACT_FAMILY_STRATEGY_ALERT,
        "schema_version": ARTIFACT_SCHEMA_VERSION,
        "producer": dipbuyer_alert.DIPBUYER_ALERT_PRODUCER,
        "status": "ok",
        "degraded_status": "healthy",
        "generated_at": "2026-04-03T16:00:00+00:00",
        "known_at": "2026-04-03T16:00:00+00:00",
        "strategy": "dip_buyer",
        "summary": {},
        "signals": [],
        "render_lines": ["Dip Buyer Scan"],
    }
    output_path = tmp_path / "dipbuyer.json"
    monkeypatch.setattr(
        dipbuyer_alert.argparse.ArgumentParser,
        "parse_args",
        lambda self: SimpleNamespace(limit=8, min_score=6, universe_size=120, review_detail_limit=2, json=True, output_json=output_path),
    )
    monkeypatch.setattr(dipbuyer_alert, "build_alert_payload", lambda **kwargs: payload)

    dipbuyer_alert.main()

    rendered = json.loads(capsys.readouterr().out)
    assert rendered["producer"] == dipbuyer_alert.DIPBUYER_ALERT_PRODUCER
    assert rendered["strategy"] == "dip_buyer"
    assert json.loads(output_path.read_text(encoding="utf-8"))["strategy"] == "dip_buyer"


def test_canslim_build_alert_payload_marks_analysis_failed(monkeypatch):
    class _ErrorAdvisor(_FakeCanSlimAdvisor):
        def __init__(self):
            super().__init__()
            self._analysis = {
                "MSFT": {"error": "provider timeout"},
                "AAPL": {"error": "provider timeout"},
            }

    monkeypatch.setenv("TRADING_INCLUDE_LEADER_BASKET_PRIORITY", "0")
    monkeypatch.setenv("TRADING_INCLUDE_WATCHLIST_PRIORITY", "0")
    monkeypatch.setattr("canslim_alert._resolve_context_overlays", lambda **kwargs: ({}, {}))
    monkeypatch.setattr("canslim_alert.build_alert_context_lines", lambda watchlist: [])
    with patch("canslim_alert.TradingAdvisor", return_value=_ErrorAdvisor()):
        payload = canslim_alert.build_alert_payload(limit=5, min_score=6, universe_size=2, review_detail_limit=2)

    assert payload["status"] == "error"
    assert payload["degraded_status"] == "degraded_risky"
    assert payload["outcome_class"] == "analysis_failed"
    assert payload["inputs"]["analysis_error_count"] == 2


def test_dipbuyer_build_alert_payload_marks_market_gate_blocked(monkeypatch):
    class _CorrectionAdvisor(_FakeDipBuyerAdvisor):
        def __init__(self):
            super().__init__()
            self._market = SimpleNamespace(
                regime=MarketRegime.CORRECTION,
                position_sizing=0.0,
                notes="market correction gate",
                status="ok",
                data_source="schwab",
                snapshot_age_seconds=0.0,
            )
            self._analysis = {
                "MSFT": {
                    "total_score": 9,
                    "data_source": "schwab",
                    "data_staleness_seconds": 22.0,
                    "recommendation": {"action": "BUY", "reason": "Strong rebound"},
                }
            }

    monkeypatch.setenv("TRADING_INCLUDE_LEADER_BASKET_PRIORITY", "0")
    monkeypatch.setenv("TRADING_INCLUDE_WATCHLIST_PRIORITY", "0")
    monkeypatch.setattr("dipbuyer_alert._resolve_context_overlays", lambda **kwargs: ({}, {}))
    monkeypatch.setattr("dipbuyer_alert.build_alert_context_lines", lambda watchlist: [])
    monkeypatch.setattr(
        "dipbuyer_alert.build_intraday_breadth_snapshot",
        lambda: {"status": "inactive", "override_state": "inactive", "override_reason": "outside regular market session", "warnings": []},
    )
    analyzer = MagicMock()
    analyzer.analyze.return_value = {"sentiment": "NEUTRAL"}
    with patch("dipbuyer_alert.TradingAdvisor", return_value=_CorrectionAdvisor()), patch(
        "dipbuyer_alert.XSentimentAnalyzer", return_value=analyzer
    ):
        payload = dipbuyer_alert.build_alert_payload(limit=5, min_score=6, universe_size=1, review_detail_limit=2)

    assert payload["status"] == "ok"
    assert payload["outcome_class"] == "market_gate_blocked"
    assert payload["degraded_status"] == "healthy"


def test_canslim_persisted_prediction_records_include_explicit_contract_fields(monkeypatch):
    captured: dict[str, object] = {}

    def _capture_predictions(**kwargs):
        captured["records"] = kwargs["records"]
        return None

    monkeypatch.setenv("TRADING_INCLUDE_LEADER_BASKET_PRIORITY", "0")
    monkeypatch.setenv("TRADING_INCLUDE_WATCHLIST_PRIORITY", "0")
    monkeypatch.setattr("canslim_alert.persist_prediction_snapshot", _capture_predictions)
    monkeypatch.setattr("canslim_alert._resolve_context_overlays", lambda **kwargs: ({}, {}))
    monkeypatch.setattr("canslim_alert.build_alert_context_lines", lambda watchlist: [])
    with patch("canslim_alert.TradingAdvisor", _FakeCanSlimAdvisor):
        canslim_alert.build_alert_payload(limit=5, min_score=6, universe_size=2, review_detail_limit=2)

    records = captured["records"]
    assert isinstance(records, list) and records
    record = records[0]
    assert record["market_regime"] == "confirmed_uptrend"
    assert record["confidence"] == 76.0
    assert record["risk"] == "low"
    assert record["entry_plan_ref"] == "canslim.breakout_entry_v1"
    assert record["execution_policy_ref"] is None
    assert record["vetoes"] == []


def test_dipbuyer_persisted_prediction_records_include_explicit_contract_fields(monkeypatch):
    captured: dict[str, object] = {}

    def _capture_predictions(**kwargs):
        captured["records"] = kwargs["records"]
        return None

    monkeypatch.setenv("TRADING_INCLUDE_LEADER_BASKET_PRIORITY", "0")
    monkeypatch.setenv("TRADING_INCLUDE_WATCHLIST_PRIORITY", "0")
    monkeypatch.setattr("dipbuyer_alert.persist_prediction_snapshot", _capture_predictions)
    monkeypatch.setattr("dipbuyer_alert._resolve_context_overlays", lambda **kwargs: ({}, {"stage": "enforced", "execution_quality": "good"}))
    monkeypatch.setattr("dipbuyer_alert.build_alert_context_lines", lambda watchlist: [])
    monkeypatch.setattr(
        "dipbuyer_alert.build_intraday_breadth_snapshot",
        lambda: {"status": "inactive", "override_state": "inactive", "override_reason": "outside regular market session", "warnings": []},
    )
    analyzer = MagicMock()
    analyzer.analyze.return_value = {"sentiment": "NEUTRAL"}

    with patch("dipbuyer_alert.TradingAdvisor", _FakeDipBuyerAdvisor), patch(
        "dipbuyer_alert.XSentimentAnalyzer", return_value=analyzer
    ):
        dipbuyer_alert.build_alert_payload(limit=5, min_score=6, universe_size=1, review_detail_limit=2)

    records = captured["records"]
    assert isinstance(records, list) and records
    record = records[0]
    assert record["market_regime"] == "uptrend_under_pressure"
    assert record["confidence"] == 73.0
    assert record["breadth_state"] == "inactive"
    assert record["entry_plan_ref"] == "dip_buyer.reversal_entry_v1"
    assert record["execution_policy_ref"] == "execution.enforced.good"
    assert record["vetoes"] == []


def test_dipbuyer_analysis_failure_predictions_include_contract_placeholders(monkeypatch):
    captured: dict[str, object] = {}

    def _capture_predictions(**kwargs):
        captured["records"] = kwargs["records"]
        return None

    class _CorrectionAdvisor(_FakeDipBuyerAdvisor):
        def __init__(self):
            super().__init__()
            self._market = SimpleNamespace(
                regime=MarketRegime.CORRECTION,
                position_sizing=0.0,
                notes="market correction gate",
                status="ok",
                data_source="schwab",
                snapshot_age_seconds=0.0,
            )
            self._analysis = {}

        def analyze_dip_stock(self, symbol: str):
            return {"symbol": symbol, "error": "market gated"}

    monkeypatch.setenv("TRADING_INCLUDE_LEADER_BASKET_PRIORITY", "0")
    monkeypatch.setenv("TRADING_INCLUDE_WATCHLIST_PRIORITY", "0")
    monkeypatch.setattr("dipbuyer_alert.persist_prediction_snapshot", _capture_predictions)
    monkeypatch.setattr("dipbuyer_alert._resolve_context_overlays", lambda **kwargs: ({}, {}))
    monkeypatch.setattr("dipbuyer_alert.build_alert_context_lines", lambda watchlist: [])
    monkeypatch.setattr(
        "dipbuyer_alert.build_intraday_breadth_snapshot",
        lambda: {"status": "inactive", "override_state": "inactive", "override_reason": "outside regular market session", "warnings": []},
    )
    analyzer = MagicMock()
    analyzer.analyze.return_value = {"sentiment": "NEUTRAL"}

    with patch("dipbuyer_alert.TradingAdvisor", _CorrectionAdvisor), patch(
        "dipbuyer_alert.XSentimentAnalyzer", return_value=analyzer
    ):
        dipbuyer_alert.build_alert_payload(limit=2, min_score=6, universe_size=2, review_detail_limit=2)

    records = captured["records"]
    assert isinstance(records, list) and records
    record = records[0]
    assert record["action"] == "NO_BUY"
    assert record["risk"] == "unknown"
    assert record["breadth_state"] == "inactive"
    assert record["entry_plan_ref"] is None
    assert record["execution_policy_ref"] is None
    assert record["vetoes"] == ["analysis_failure"]
