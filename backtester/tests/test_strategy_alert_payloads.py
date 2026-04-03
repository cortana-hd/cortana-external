from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from data.market_regime import MarketRegime
from evaluation.artifact_contracts import ARTIFACT_FAMILY_STRATEGY_ALERT, ARTIFACT_SCHEMA_VERSION

import canslim_alert
import dipbuyer_alert


class _FakeCanSlimAdvisor:
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
                "recommendation": {
                    "action": "BUY",
                    "reason": "Strong setup",
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
                "recommendation": {
                    "action": "BUY",
                    "reason": "Strong rebound",
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
    assert payload["summary"]["scanned"] == 2
    assert payload["summary"]["threshold_passed"] == 1
    assert payload["inputs"]["source_counts"] == {"schwab": 1, "cache": 1}
    assert payload["signals"][0]["symbol"] == "MSFT"
    assert payload["signals"][0]["data_source"] == "schwab"
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
    assert payload["summary"]["buy_count"] == 1
    assert payload["inputs"]["source_counts"] == {"schwab": 1}
    assert payload["overlays"]["breadth"]["override_state"] == "inactive"
    assert payload["signals"][0]["symbol"] == "MSFT"
    assert payload["render_lines"][0] == "Dip Buyer Scan"


def test_canslim_main_emits_json_payload(monkeypatch, capsys):
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
    monkeypatch.setattr(
        canslim_alert.argparse.ArgumentParser,
        "parse_args",
        lambda self: SimpleNamespace(limit=8, min_score=6, universe_size=120, review_detail_limit=2, json=True),
    )
    monkeypatch.setattr(canslim_alert, "build_alert_payload", lambda **kwargs: payload)

    canslim_alert.main()

    rendered = json.loads(capsys.readouterr().out)
    assert rendered["producer"] == canslim_alert.CANSLIM_ALERT_PRODUCER
    assert rendered["strategy"] == "canslim"


def test_dipbuyer_main_emits_json_payload(monkeypatch, capsys):
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
    monkeypatch.setattr(
        dipbuyer_alert.argparse.ArgumentParser,
        "parse_args",
        lambda self: SimpleNamespace(limit=8, min_score=6, universe_size=120, review_detail_limit=2, json=True),
    )
    monkeypatch.setattr(dipbuyer_alert, "build_alert_payload", lambda **kwargs: payload)

    dipbuyer_alert.main()

    rendered = json.loads(capsys.readouterr().out)
    assert rendered["producer"] == dipbuyer_alert.DIPBUYER_ALERT_PRODUCER
    assert rendered["strategy"] == "dip_buyer"
