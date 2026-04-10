from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import data.intraday_breadth as module


def _market_time(hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 3, 31, hour, minute, tzinfo=ZoneInfo("America/New_York"))


def test_build_intraday_breadth_snapshot_selective_buy_when_broad_rally(monkeypatch):
    monkeypatch.setattr(module, "GROWTH_WATCHLIST", ["NVDA", "MSFT", "AMD"])
    monkeypatch.setattr(module, "_load_base_universe_symbols", lambda service_base_url: (["AAA", "BBB", "CCC", "DDD"], None))
    monkeypatch.setattr(
        module,
        "_quote_batch",
        lambda symbols, service_base_url, chunk_size=120: (
            [
                {"symbol": "SPY", "data": {"changePercent": 1.8}},
                {"symbol": "QQQ", "data": {"changePercent": 2.4}},
                {"symbol": "IWM", "data": {"changePercent": 1.1}},
                {"symbol": "DIA", "data": {"changePercent": 1.0}},
                {"symbol": "AAA", "data": {"changePercent": 1.0}},
                {"symbol": "BBB", "data": {"changePercent": 0.8}},
                {"symbol": "CCC", "data": {"changePercent": 0.4}},
                {"symbol": "DDD", "data": {"changePercent": -0.2}},
                {"symbol": "NVDA", "data": {"changePercent": 3.0}},
                {"symbol": "MSFT", "data": {"changePercent": 2.2}},
                {"symbol": "AMD", "data": {"changePercent": -0.4}},
            ],
            [],
        ),
    )

    snapshot = module.build_intraday_breadth_snapshot(service_base_url="http://service", now=_market_time(12, 0))

    assert snapshot["status"] == "ok"
    assert snapshot["override_state"] == "selective-buy"
    assert snapshot["s_and_p"]["pct_up"] == 0.75
    assert snapshot["growth"]["pct_up"] == 2 / 3
    assert snapshot["strong_up_day_flag"] is False


def test_build_intraday_breadth_snapshot_stays_inactive_when_breadth_is_narrow(monkeypatch):
    monkeypatch.setattr(module, "GROWTH_WATCHLIST", ["NVDA", "MSFT", "AMD"])
    monkeypatch.setattr(module, "_load_base_universe_symbols", lambda service_base_url: (["AAA", "BBB", "CCC", "DDD"], None))
    monkeypatch.setattr(
        module,
        "_quote_batch",
        lambda symbols, service_base_url, chunk_size=120: (
            [
                {"symbol": "SPY", "data": {"changePercent": 1.7}},
                {"symbol": "QQQ", "data": {"changePercent": 2.1}},
                {"symbol": "IWM", "data": {"changePercent": 0.2}},
                {"symbol": "DIA", "data": {"changePercent": 0.1}},
                {"symbol": "AAA", "data": {"changePercent": 1.2}},
                {"symbol": "BBB", "data": {"changePercent": -1.0}},
                {"symbol": "CCC", "data": {"changePercent": -0.8}},
                {"symbol": "DDD", "data": {"changePercent": -0.3}},
                {"symbol": "NVDA", "data": {"changePercent": 2.6}},
                {"symbol": "MSFT", "data": {"changePercent": -0.8}},
                {"symbol": "AMD", "data": {"changePercent": -1.1}},
            ],
            [],
        ),
    )

    snapshot = module.build_intraday_breadth_snapshot(service_base_url="http://service", now=_market_time(13, 5))

    assert snapshot["status"] == "ok"
    assert snapshot["override_state"] == "watch_only"
    assert "breadth is not broad enough" in snapshot["override_reason"]
    assert snapshot["narrow_rally_flag"] is True
    assert snapshot["authority_cap"] == "watch_only"


def test_build_intraday_breadth_snapshot_marks_unavailable_when_coverage_is_too_low(monkeypatch):
    monkeypatch.setattr(module, "GROWTH_WATCHLIST", ["NVDA", "MSFT", "AMD"])
    monkeypatch.setattr(module, "_load_base_universe_symbols", lambda service_base_url: (["AAA", "BBB", "CCC", "DDD"], None))
    monkeypatch.setattr(
        module,
        "_quote_batch",
        lambda symbols, service_base_url, chunk_size=120: (
            [
                {"symbol": "SPY", "data": {"changePercent": 1.8}},
                {"symbol": "QQQ", "data": {"changePercent": 2.4}},
                {"symbol": "AAA", "data": {"changePercent": 1.0}},
                {"symbol": "NVDA", "data": {"changePercent": 3.0}},
            ],
            [],
        ),
    )

    snapshot = module.build_intraday_breadth_snapshot(service_base_url="http://service", now=_market_time(14, 10))

    assert snapshot["status"] == "degraded"
    assert snapshot["override_state"] == "unavailable"
    assert "coverage" in " ".join(snapshot["warnings"])


def test_build_intraday_breadth_snapshot_preserves_provider_mode(monkeypatch):
    monkeypatch.setattr(module, "GROWTH_WATCHLIST", ["NVDA"])
    monkeypatch.setattr(module, "_load_base_universe_symbols", lambda service_base_url: (["AAA"], None))
    monkeypatch.setattr(
        module,
        "_quote_batch",
        lambda symbols, service_base_url, chunk_size=120: (
            [
                {"symbol": "SPY", "data": {"changePercent": 1.8}},
                {"symbol": "QQQ", "data": {"changePercent": 2.4}},
                {"symbol": "IWM", "data": {"changePercent": 1.1}},
                {"symbol": "DIA", "data": {"changePercent": 1.0}},
                {"symbol": "AAA", "data": {"changePercent": 0.8}},
                {"symbol": "NVDA", "data": {"changePercent": 3.0}},
            ],
            [],
            {
                "provider_mode": "alpaca_fallback",
                "fallback_engaged": True,
                "provider_mode_reason": "Intraday breadth entered the declared Alpaca fallback lane.",
            },
        ),
    )

    snapshot = module.build_intraday_breadth_snapshot(service_base_url="http://service", now=_market_time(12, 15))

    assert snapshot["provider_mode"] == "alpaca_fallback"
    assert snapshot["fallback_engaged"] is True
    assert "declared Alpaca fallback lane" in snapshot["provider_mode_reason"]


def test_render_intraday_breadth_lines_includes_watch_only_label():
    lines = module.render_intraday_breadth_lines(
        {
            "override_state": "watch_only",
            "override_reason": "constructive but not broad enough",
            "s_and_p": {"pct_up": 0.62, "up": 310, "total": 500},
            "growth": {"pct_up": 0.55, "up": 55, "total": 100},
            "tape": {"SPY": 1.2, "QQQ": 1.4},
            "warnings": [],
        }
    )

    assert any("watch-only" in line for line in lines)
