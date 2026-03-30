from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path


FORMATTER_PATH = Path(__file__).resolve().parents[1] / "scripts" / "local_output_formatter.py"
SPEC = spec_from_file_location("local_output_formatter", FORMATTER_PATH)
MODULE = module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def test_format_alert_simplifies_context_and_decision():
    raw = """CANSLIM Scan
Market: correction — no new positions
Alert posture: review only — correction regime. Treat surfaced names as a watchlist, not a buy-now alert.
Calibration note: uncalibrated — no settled outcomes yet, so confidence is still model-estimated rather than proven.
Polymarket: Fed easing odds 64% (0 pts/24h); US recession odds 36% (0 pts/24h)
Overlay: Risk-on conflict — Polymarket is leaning risk-on, but the current equity regime is not fully supportive.
Risk budget: remaining 0% | cap 0% | aggression lean more selective | note market regime correction
Execution quality: quality good | liquidity high | slippage high | good liquidity | high | slippage high (155.2bps)
Universe selection: 96 pinned | 24 ranked | source cache | cache age 0.9h
Scanned 120 | market gate active | 0 BUY | 0 WATCH
Why no buys: Regime score -7: 6 distribution days and -5.9% drawdown. Stay defensive.
"""
    text = MODULE.format_alert(raw)

    assert "Takeaway" in text
    assert "- Market: correction — no new positions" in text
    assert "- Alert posture: review only — correction regime. Treat surfaced names as a watchlist, not a buy-now alert." in text
    assert "- Calibration: uncalibrated — no settled outcomes yet, so confidence is still model-estimated rather than proven." in text
    assert "- Macro: Risk-on conflict — Polymarket is leaning risk-on, but the current equity regime is not fully supportive." in text
    assert "- Risk: remaining risk budget 0% | exposure cap 0% | market regime correction" in text
    assert "- Trading conditions: quality good | liquidity high | slippage high" in text
    assert "- Scan input: 96 pinned + 24 ranked names | source cache | cache age 0.9h" in text
    assert "- Why no buys: Regime score -7: 6 distribution days and -5.9% drawdown. Stay defensive." in text


def test_format_alert_surfaces_leader_bucket_overlap(tmp_path):
    leader_path = tmp_path / "leader-baskets.json"
    leader_path.write_text(
        json.dumps(
            {
                "buckets": {
                    "daily": [{"symbol": "OXY"}, {"symbol": "APA"}],
                    "weekly": [{"symbol": "OXY"}, {"symbol": "APA"}, {"symbol": "GEV"}],
                    "monthly": [{"symbol": "OXY"}, {"symbol": "APA"}, {"symbol": "GEV"}, {"symbol": "MPC"}],
                },
                "priority": {"symbols": ["OXY", "APA", "GEV", "MPC"]},
            }
        ),
        encoding="utf-8",
    )
    raw = """CANSLIM Scan
Market: correction — no new positions
Universe selection: 20 pinned | 100 ranked | source cache | cache age 0.0h
Scanned 120 | market gate active | 0 BUY | 0 WATCH
Top names considered: OXY, APA, GEV
Why no buys: Stay defensive
"""
    text = MODULE.format_alert(raw, leader_bucket_path=str(leader_path))

    assert "- Leader-bucket overlap: priority OXY, APA, GEV | daily OXY, APA | weekly OXY, APA, GEV | monthly OXY, APA, GEV" in text


def test_format_quick_check_strips_runtime_noise_and_simplifies_verdict():
    raw = """/tmp/site-packages/provider/history.py:173: Pandas4Warning: Timestamp.utcnow is deprecated
  dt_now = pd.Timestamp.utcnow()
Quick check: BTC -> avoid for now
Path: dip_buyer | Asset: crypto
Polymarket: conflicting | Divergence watch | themes crypto-policy
Risk budget: remaining 0% | cap 0% | aggression lean more selective | note market regime correction
Execution quality: quality good | liquidity high | slippage high | good liquidity | high | slippage high (196.5bps)
Reason: The stock is still under pressure. Current price $104.00 is below the 5-day average of $106.00. Wait until it stops falling and closes above $106.00. Polymarket context: conflicting on crypto-policy.
Base action: NO_BUY | Score 7/12 | Confidence 16%
"""
    text = MODULE.format_quick_check(raw)

    assert "Pandas4Warning" not in text
    assert "dt_now = pd.Timestamp.utcnow()" not in text
    assert "- Setup: dip_buyer | Asset: crypto" in text
    assert "- Macro: conflicting | Divergence watch | themes crypto-policy" in text
    assert "- Why: The stock is still under pressure. Current price $104.00 is below the 5-day average of $106.00. Wait until it stops falling and closes above $106.00. Polymarket context: conflicting on crypto-policy." in text
    assert "- Model output: NO_BUY | Score 7/12 | Confidence 16%" in text


def test_format_leader_baskets_surfaces_daily_weekly_monthly_names():
    raw = """{
  "generated_at": "2026-03-20T20:00:00+00:00",
  "buckets": {
    "daily": [
      {"symbol": "NVDA", "window_return_pct": 3.2, "appearances": 1, "latest_rank_score": 12.4, "actions": ["BUY"]},
      {"symbol": "AMD", "window_return_pct": null, "appearances": 1, "latest_rank_score": 9.1, "actions": ["WATCH"]}
    ],
    "weekly": [
      {"symbol": "NVDA", "window_return_pct": 8.4, "appearances": 4, "latest_rank_score": 12.4, "actions": ["BUY"]},
      {"symbol": "MSFT", "window_return_pct": 0.0, "appearances": 3, "latest_rank_score": 10.8, "actions": ["WATCH"]}
    ],
    "monthly": [
      {"symbol": "NVDA", "window_return_pct": 16.2, "appearances": 9, "latest_rank_score": 12.4, "actions": ["BUY"]},
      {"symbol": "META", "window_return_pct": 12.5, "appearances": 7, "latest_rank_score": 11.3, "actions": ["WATCH"]},
      {"symbol": "AAPL", "window_return_pct": 9.0, "appearances": 5, "latest_rank_score": 9.9, "actions": ["NO_BUY"]}
    ]
  },
  "priority": {
    "symbols": ["NVDA", "AMD", "MSFT", "META"]
  }
}"""
    text = MODULE.format_leader_baskets(raw)

    assert "Leader buckets" in text
    assert "- Updated: 2026-03-20T20:00:00+00:00" in text
    assert "- Priority set: NVDA, AMD, MSFT, META" in text
    assert "- Format: window move | flat = near-zero move | seen N times = how often the name appeared in recent leader snapshots | strength = internal leader score (higher is stronger) | latest = most recent nightly call" in text
    assert "- Daily: NVDA +3.2% (seen 1 time | strength 12.4 | latest BUY), AMD no window return yet (seen 1 time | strength 9.1 | latest WATCH)" in text
    assert "- Weekly: NVDA +8.4% (seen 4 times | strength 12.4 | latest BUY), MSFT flat (seen 3 times | strength 10.8 | latest WATCH)" in text
    assert "- Monthly: NVDA +16.2% (seen 9 times | strength 12.4 | latest BUY), META +12.5% (seen 7 times | strength 11.3 | latest WATCH), AAPL +9.0% (seen 5 times | strength 9.9 | latest NO_BUY)" in text


def test_format_market_data_ops_surfaces_role_budget_and_universe_state():
    raw = json.dumps(
        {
            "data": {
                "streamerRoleConfigured": "auto",
                "streamerRoleActive": "leader",
                "streamerLockHeld": True,
                "providerMetrics": {
                    "fallbackUsage": {"shared_state": 2},
                    "sourceUsage": {"schwab_streamer": 12, "schwab": 3},
                },
                "health": {
                    "providers": {
                        "schwabStreamerMeta": {
                            "operatorState": "healthy",
                            "failurePolicy": None,
                            "connected": True,
                            "operatorAction": "No operator action required.",
                            "subscriptionBudget": {
                                "LEVELONE_EQUITIES": {
                                    "requestedSymbols": 40,
                                    "softCap": 250,
                                    "headroomRemaining": 210,
                                    "overSoftCap": False,
                                    "lastPrunedCount": 0,
                                },
                                "CHART_EQUITY": {
                                    "requestedSymbols": 10,
                                    "softCap": 250,
                                    "headroomRemaining": 240,
                                    "overSoftCap": False,
                                    "lastPrunedCount": 0,
                                },
                            },
                        }
                    }
                },
                "universe": {
                    "latest": {"source": "remote_json", "updatedAt": "2026-03-21T20:00:00+00:00"},
                    "ownership": {
                        "refreshPolicy": "TS owns the artifact refresh path; the bundled S&P artifact is the default base-universe source."
                    },
                },
            }
        }
    )
    text = MODULE.format_market_data_ops(raw)

    assert "Market data ops" in text
    assert "- Live Schwab feed owner: leader (configured auto) | lock held yes" in text
    assert "- Live feed status: healthy | policy none | connected yes" in text
    assert "- Live feed subscription budget: LEVELONE_EQUITIES: 40/250 requested | headroom 210 | CHART_EQUITY: 10/250 requested | headroom 240" in text
    assert "- Provider usage this run: shared_state 2 | primary source mix schwab 3, schwab_streamer 12" in text
    assert "- Base universe source: remote_json | updated 2026-03-21T20:00:00+00:00" in text


def test_format_market_data_ops_explains_disconnected_stream_is_ok():
    raw = json.dumps(
        {
            "data": {
                "streamerRoleConfigured": "leader",
                "streamerRoleActive": "leader",
                "streamerLockHeld": False,
                "providerMetrics": {
                    "fallbackUsage": {"shared_state": 0},
                    "sourceUsage": {"schwab": 5},
                },
                "health": {
                    "providers": {
                        "schwabStreamerMeta": {
                            "operatorState": "healthy",
                            "failurePolicy": None,
                            "connected": False,
                        }
                    }
                },
                "universe": {
                    "latest": {"source": "local_json", "updatedAt": "2026-03-24T01:03:49.815Z"},
                    "ownership": {
                        "refreshPolicy": "TS owns the artifact refresh path; the bundled S&P artifact is the default base-universe source."
                    },
                },
            }
        }
    )
    text = MODULE.format_market_data_ops(raw)

    assert "connected no (REST fallback is still okay)" in text


def test_format_alert_expands_abstains_and_vetoes_line_by_line():
    raw = """Dip Buyer Scan
Market: correction
Qualified setups: 14 of 120 scanned | BUY 0 | WATCH 1
Abstains: O NO_BUY | tq 4.6 | conf 17% u 35% | down/churn 12.4/9.0 | stress severe(67) | ABSTAIN | reasons The stock is still under pressure and has not confirmed a bounce yet.; CL NO_BUY | tq 2.2 | conf 17% u 35% | down/churn 17.1/9.0 | stress severe(67) | ABSTAIN | reasons The stock is still under pressure and has not confirmed a bounce yet.
Vetoes: O NO_BUY | tq 4.6 | conf 17% u 35% | down/churn 12.4/9.0 | stress severe(67) | ABSTAIN | veto falling-knife | reason The stock is still under pressure and has not confirmed a bounce yet.; CL NO_BUY | tq 2.2 | conf 17% u 35% | down/churn 17.1/9.0 | stress severe(67) | ABSTAIN | veto falling-knife | reason The stock is still under pressure and has not confirmed a bounce yet.
"""
    text = MODULE.format_alert(raw)

    assert "- Abstains:\n  O: NO_BUY | tq 4.6" in text
    assert "\n  CL: NO_BUY | tq 2.2" in text
    assert "- Vetoes:\n  O: NO_BUY | tq 4.6" in text
