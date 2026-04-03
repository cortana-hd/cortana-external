from __future__ import annotations

import json

from trade_lifecycle_cycle import run_cycle
from trade_lifecycle_report import build_report, render_report


def _write_alert(path, payload):
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_cycle_opens_and_closes_positions_from_alerts(tmp_path):
    canslim_path = tmp_path / "canslim.json"
    dip_path = tmp_path / "dip.json"
    _write_alert(
        canslim_path,
        {
            "strategy": "canslim",
            "market": {"label": "confirmed_uptrend", "status": "ok"},
            "overlays": {
                "risk": {"state": "open"},
                "execution": {"estimated_slippage_bps": 12.0, "execution_quality": "good"},
            },
            "signals": [
                {
                    "symbol": "MSFT",
                    "action": "BUY",
                    "price": 100.0,
                    "reason": "Strong breakout",
                    "trade_quality_score": 80.0,
                    "effective_confidence": 72.0,
                    "entry_plan": {
                        "plan_key": "canslim:MSFT:plan",
                        "schema_version": "lifecycle.v1",
                        "entry_price_ideal_min": 99.0,
                        "entry_price_ideal_max": 101.0,
                        "initial_stop_price": 95.0,
                        "first_target_price": 108.0,
                        "stretch_target_price": 112.0,
                        "executable": True,
                    },
                }
            ],
        },
    )
    _write_alert(
        dip_path,
        {
            "strategy": "dip_buyer",
            "market": {"label": "correction", "status": "ok"},
            "overlays": {
                "risk": {"state": "tight"},
                "execution": {"estimated_slippage_bps": 18.0, "execution_quality": "good"},
            },
            "signals": [],
        },
    )

    first = run_cycle(
        alert_paths=[canslim_path, dip_path],
        root=tmp_path / "ledger",
        generated_at="2026-04-03T20:00:00+00:00",
    )
    assert first["summary"]["opened_count"] == 1
    assert first["summary"]["open_count"] == 1

    _write_alert(
        canslim_path,
        {
            "strategy": "canslim",
            "market": {"label": "confirmed_uptrend", "status": "ok"},
            "overlays": {"risk": {"state": "open"}, "execution": {"estimated_slippage_bps": 12.0, "execution_quality": "good"}},
            "signals": [
                {
                    "symbol": "MSFT",
                    "action": "NO_BUY",
                    "price": 109.0,
                    "reason": "Setup failed",
                }
            ],
        },
    )
    second = run_cycle(
        alert_paths=[canslim_path, dip_path],
        root=tmp_path / "ledger",
        generated_at="2026-04-05T20:00:00+00:00",
    )
    assert second["summary"]["closed_count"] == 1
    assert second["closed_positions"][0]["exit_reason"] == "target_hit"


def test_report_renders_lifecycle_summary(tmp_path):
    alert_path = tmp_path / "canslim.json"
    _write_alert(
        alert_path,
        {
            "strategy": "canslim",
            "market": {"label": "confirmed_uptrend", "status": "ok"},
            "overlays": {
                "risk": {"state": "open"},
                "execution": {"estimated_slippage_bps": 12.0, "execution_quality": "good"},
            },
            "signals": [
                {
                    "symbol": "NVDA",
                    "action": "BUY",
                    "price": 200.0,
                    "reason": "Breakout",
                    "trade_quality_score": 78.0,
                    "effective_confidence": 70.0,
                    "entry_plan": {
                        "plan_key": "canslim:NVDA:plan",
                        "schema_version": "lifecycle.v1",
                        "entry_price_ideal_min": 198.0,
                        "entry_price_ideal_max": 202.0,
                        "initial_stop_price": 190.0,
                        "first_target_price": 216.0,
                        "stretch_target_price": 224.0,
                        "executable": True,
                    },
                }
            ],
        },
    )
    run_cycle(
        alert_paths=[alert_path],
        root=tmp_path / "ledger",
        generated_at="2026-04-03T20:00:00+00:00",
    )
    report = build_report(root=tmp_path / "ledger")
    rendered = render_report(report)

    assert report["summary"]["open_count"] == 1
    assert "Trade lifecycle" in rendered
    assert "Open 1" in rendered
    assert "NVDA" in rendered
