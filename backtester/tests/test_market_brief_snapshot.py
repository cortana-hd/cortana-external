from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import market_brief_snapshot as module
from data.market_regime import MarketRegime, MarketStatus
from evaluation.artifact_contracts import ARTIFACT_FAMILY_MARKET_BRIEF, ARTIFACT_SCHEMA_VERSION


def make_status(**overrides):
    payload = {
        "regime": MarketRegime.CORRECTION,
        "distribution_days": 7,
        "last_ftd": "",
        "trend_direction": "down",
        "position_sizing": 0.0,
        "notes": "Stay defensive.",
        "data_source": "schwab",
        "provider_mode": "schwab_primary",
        "fallback_engaged": False,
        "provider_mode_reason": "Market regime stayed on the Schwab primary lane.",
        "status": "ok",
        "degraded_reason": "",
        "snapshot_age_seconds": 0.0,
        "next_action": "",
        "regime_score": -7,
        "drawdown_pct": -5.4,
        "recent_return_pct": -4.0,
    }
    payload.update(overrides)
    return MarketStatus(**payload)


def test_classify_posture_respects_regime():
    correction = module.classify_posture(make_status(regime=MarketRegime.CORRECTION))
    assert correction["action"] == "NO_BUY"

    selective = module.classify_posture(
        make_status(regime=MarketRegime.CORRECTION),
        breadth_snapshot={"override_state": "selective-buy"},
    )
    assert selective["action"] == "BUY"
    assert "tightly selective buys" in selective["reason"]

    watch = module.classify_posture(make_status(regime=MarketRegime.UPTREND_UNDER_PRESSURE, position_sizing=0.5))
    assert watch["action"] == "WATCH"

    buy = module.classify_posture(make_status(regime=MarketRegime.CONFIRMED_UPTREND, position_sizing=1.0, notes="Trend is supportive."))
    assert buy["action"] == "BUY"
    assert "Trend is supportive" in buy["reason"]


def test_build_tape_summary_and_risk_tone():
    quotes = [
        {"symbol": "SPY", "change_percent": -0.62},
        {"symbol": "QQQ", "change_percent": -0.91},
        {"symbol": "IWM", "change_percent": -0.55},
        {"symbol": "DIA", "change_percent": -0.21},
        {"symbol": "GLD", "change_percent": 0.46},
        {"symbol": "TLT", "change_percent": 0.12},
    ]
    assert module.classify_tape_risk(quotes) == "defensive"
    summary = module.build_tape_summary(quotes)
    assert "SPY weak" in summary
    assert "Risk tone defensive" in summary


def test_humanize_market_issue_prefers_plain_english():
    assert module.humanize_market_issue("service: Schwab REST cooldown open until 2026-04-02T08:00:00Z") == (
        "Schwab market data is in a brief cooldown"
    )
    assert module.humanize_market_issue("HTTP 503 Service Unavailable") == (
        "the live market-data service is temporarily unavailable"
    )
    assert module.humanize_market_issue("connection refused. Automatic restart did not restore the local market-data service.") == (
        "the local market-data service is unreachable"
    )


def test_build_focus_names_prefers_leaders_then_macro():
    focus = module.build_focus_names(["OXY", "QQQ", "FANG"], ["MSFT", "NVDA", "OXY"])
    assert focus["symbols"] == ["OXY", "FANG", "MSFT"]
    assert focus["sources"] == ["leader_priority", "polymarket"]
    assert "Leader-priority names came first" in focus["reason"]


def test_load_cached_tape_quotes_uses_previous_session_history(monkeypatch, tmp_path):
    monkeypatch.setattr(module, "MARKET_DATA_CACHE_DIR", tmp_path)
    monkeypatch.setenv("MARKET_BRIEF_TAPE_FALLBACK_MAX_AGE_HOURS", "72")
    latest = datetime.now(UTC) - timedelta(hours=24)
    previous = latest - timedelta(days=1)
    payload = {
        "generated_at_utc": latest.isoformat(),
        "source": "schwab",
        "rows": [
            {"date": previous.isoformat(), "Open": 0, "High": 0, "Low": 0, "Close": 100.0, "Volume": 1},
            {"date": latest.isoformat(), "Open": 0, "High": 0, "Low": 0, "Close": 102.0, "Volume": 1},
        ],
    }
    for symbol in ("SPY", "QQQ"):
        (tmp_path / f"{symbol}_1y.json").write_text(json.dumps(payload), encoding="utf-8")

    snapshot = module.load_cached_tape_quotes(symbols=("SPY", "QQQ"))

    assert snapshot["status"] == "degraded"
    assert snapshot["primary_source"] == "cache"
    assert snapshot["provider_mode"] == "cache_fallback"
    assert "Previous session fallback" in snapshot["summary_line"]
    assert snapshot["symbols"][0]["symbol"] == "SPY"


def test_build_snapshot_collects_expected_sections(monkeypatch):
    monkeypatch.setattr(module.TradingAdvisor, "get_market_status", lambda self, refresh=True: make_status())
    monkeypatch.setattr(
        module,
        "build_intraday_breadth_snapshot",
        lambda service_base_url="http://service": {
            "status": "ok",
            "override_state": "inactive",
            "override_reason": "outside regular market session",
            "provider_mode": "schwab_primary",
            "fallback_engaged": False,
            "provider_mode_reason": "Intraday breadth stayed on the Schwab primary lane.",
            "warnings": [],
        },
    )
    monkeypatch.setattr(
        module,
        "load_structured_context",
        lambda max_age_hours=12.0: {
            "summary": {
                "conviction": "neutral",
                "divergence": {"state": "watch", "summary": "Mixed theme watch"},
                "themeHighlights": [
                    {"title": "Fed easing odds", "watchTickers": ["QQQ", "NVDA", "MSFT"]},
                ],
            },
            "metadata": {"generatedAt": "2026-03-31T12:00:00Z"},
        },
    )
    monkeypatch.setattr(module, "load_leader_priority_symbols", lambda max_age_hours=72.0: ["OXY", "FANG"])
    monkeypatch.setattr(
        module,
        "load_shadow_inputs",
        lambda: (
            {"comparisons": {"by_strategy_action": [{"strategy": "dip_buyer", "action": "BUY", "settled_count": 25, "mean_return_pct": 3.0, "hit_rate": 0.62, "expectancy": 1.5}]}},
            {"summary": {"by_confidence_bucket": [{"confidence_bucket": "high", "sample_count": 25, "avg_return_pct": 2.5, "hit_rate": 0.64}]}},
            [],
        ),
    )
    monkeypatch.setattr(
        module,
        "build_surface_research_runtime",
        lambda generated_at: {
            "artifact_family": "research_runtime_snapshot",
            "summary": {
                "health_status": "degraded",
                "hot_count": 0,
                "fresh_count": 0,
                "stale_usable_count": 0,
                "summary_line": "Research plane has no hot-path artifacts yet; decisions are not blocked.",
            },
            "hot_path_reads": [],
            "warm_lane_registry": [],
            "cold_lane_registry": [],
        },
    )
    monkeypatch.setattr(
        module,
        "requests",
        SimpleNamespace(
            get=lambda *args, **kwargs: SimpleNamespace(
                raise_for_status=lambda: None,
                json=lambda: {
                    "data": {
                        "items": [
                            {"symbol": "SPY", "source": "schwab", "status": "ok", "data": {"price": 500, "changePercent": -0.3}},
                            {"symbol": "QQQ", "source": "schwab", "status": "ok", "data": {"price": 420, "changePercent": -0.4}},
                            {"symbol": "IWM", "source": "schwab", "status": "ok", "data": {"price": 200, "changePercent": -0.2}},
                            {"symbol": "DIA", "source": "schwab", "status": "ok", "data": {"price": 390, "changePercent": -0.1}},
                            {"symbol": "GLD", "source": "schwab", "status": "ok", "data": {"price": 210, "changePercent": 0.5}},
                            {"symbol": "TLT", "source": "schwab", "status": "ok", "data": {"price": 95, "changePercent": 0.1}},
                        ]
                    }
                    ,
                    "providerMode": "schwab_primary",
                    "fallbackEngaged": False,
                    "providerModeReason": "Tape stayed on the Schwab primary lane.",
                },
            )
        ),
    )

    snapshot = module.build_snapshot("http://service")

    assert snapshot["artifact_family"] == ARTIFACT_FAMILY_MARKET_BRIEF
    assert snapshot["schema_version"] == ARTIFACT_SCHEMA_VERSION
    assert snapshot["producer"] == module.MARKET_BRIEF_PRODUCER
    assert snapshot["outcome_class"] == "market_gate_blocked"
    assert snapshot["degraded_status"] == "healthy"
    assert snapshot["known_at"] == snapshot["generated_at"]
    assert snapshot["posture"]["action"] == "NO_BUY"
    assert snapshot["session"]["phase"] in {"PREMARKET", "OPEN", "AFTER_HOURS", "CLOSED"}
    assert snapshot["macro"]["summary_line"].startswith("Polymarket neutral")
    assert snapshot["tape"]["primary_source"] == "schwab"
    assert snapshot["provider_mode"] == "schwab_primary"
    assert snapshot["subsystem_provider_modes"]["market_regime"] == "schwab_primary"
    assert snapshot["subsystem_provider_modes"]["market_brief_tape"] == "schwab_primary"
    assert snapshot["focus"]["symbols"] == ["OXY", "FANG", "NVDA"]
    assert snapshot["regime"]["display"] == "CORRECTION"
    assert snapshot["intraday_breadth"]["override_state"] == "inactive"
    assert snapshot["decision_state"]["artifact_family"] == "decision_state"
    assert snapshot["adaptive_weights"]["artifact_family"] == "adaptive_weight_snapshot"
    assert snapshot["research_runtime"]["artifact_family"] == "research_runtime_snapshot"
    assert snapshot["shadow_review"]["artifact_family"] == "decision_brain_shadow_review"
    assert snapshot["operator_payload"]["artifact_family"] == "operator_payload"
    assert snapshot["operator_payload"]["surface_type"] == "brief"
    assert snapshot["operator_payload"]["decision_contract_ref"]["artifact_family"] == "decision_state"
    assert snapshot["operator_summary"]["headline"].endswith("| size 0%")
    assert "Tape is using fresh live quotes." == snapshot["operator_summary"]["read_this_as"]["tape"]
    assert snapshot["operator_summary"]["read_this_as"]["narrative"].startswith("Narrative overlay is nudging confidence toward")
    assert snapshot["operator_summary"]["read_this_as"]["research"].startswith("Research plane has no hot-path artifacts yet")
    assert snapshot["operator_summary"]["read_this_as"]["focus"].startswith("OXY, FANG, NVDA.")
    assert snapshot["freshness"]["tape_primary_source"] == "schwab"
    assert snapshot["freshness"]["provider_mode"] == "schwab_primary"


def test_format_operator_text_renders_human_summary():
    payload = {
        "outcome_class": "market_gate_blocked",
        "degraded_status": "healthy",
        "operator_summary": {
            "headline": "OPEN: WATCH | CORRECTION | size 0%",
            "what_this_means": "Stay defensive.",
            "read_this_as": {
                "session": "This is a regular session snapshot.",
                "regime": "Market regime is CORRECTION (15m old).",
                "tape": "Tape is using fresh live quotes.",
                "macro": "Macro overlay is watch (30m old).",
                "breadth": "Intraday breadth is unavailable because live inputs are missing.",
                "narrative": "Narrative overlay is bounded; no extra authority is active.",
                "research": "Research plane has no hot-path artifacts yet; decisions are not blocked.",
                "shadow": "Shadow review: live posture WATCH; shadow posture WATCH; session OPEN.",
                "focus": "OXY, GEV, FANG. Focus names came from the leader-priority list.",
            },
        },
        "warnings": ["one", "two", "three", "four"],
    }

    text = module.format_operator_text(payload)

    assert "OPEN: WATCH | CORRECTION | size 0%" in text
    assert "Status: valid defensive snapshot; market regime is blocking new risk." in text
    assert "Session: This is a regular session snapshot." in text
    assert "Narrative: Narrative overlay is bounded; no extra authority is active." in text
    assert "Research: Research plane has no hot-path artifacts yet; decisions are not blocked." in text
    assert "Shadow: Shadow review: live posture WATCH; shadow posture WATCH; session OPEN." in text
    assert "Warnings: one, two, three" in text


def test_build_operator_summary_prefers_underlying_age_for_cached_regime():
    summary = module.build_operator_summary(
        session_phase="AFTER_HOURS",
        posture={"action": "NO_BUY", "reason": "Stay defensive."},
        regime={
            "display": "CORRECTION",
            "position_sizing_pct": 0.0,
            "status": "ok",
            "data_source": "cache",
            "snapshot_age_seconds": 180.0,
            "notes": "Regime score -8. [DEGRADED: computed from cached history, age=97.3h]",
            "degraded_reason": "",
        },
        tape={"primary_source": "unavailable"},
        macro={"state": "watch", "freshness_hours": 2.0},
        breadth={"override_state": "inactive", "override_reason": "outside regular market session"},
        focus={"symbols": ["NVDA"], "reason": "Focus names came from the Polymarket macro watchlist."},
    )

    assert summary["read_this_as"]["regime"] == (
        "Market regime is CORRECTION using cached history (underlying inputs ~97.3h old)."
    )


def test_build_operator_summary_calls_out_alpaca_fallback_mode():
    summary = module.build_operator_summary(
        session_phase="OPEN",
        posture={"action": "WATCH", "reason": "Stay selective."},
        regime={
            "display": "UPTREND UNDER PRESSURE",
            "position_sizing_pct": 50.0,
            "status": "degraded",
            "data_source": "alpaca",
            "provider_mode": "alpaca_fallback",
            "snapshot_age_seconds": 120.0,
            "notes": "Fallback active.",
            "degraded_reason": "Schwab REST cooldown.",
        },
        tape={
            "primary_source": "alpaca",
            "provider_mode": "alpaca_fallback",
        },
        macro={"state": "watch", "freshness_hours": 2.0},
        breadth={
            "override_state": "watch_only",
            "override_reason": "breadth is constructive",
            "provider_mode": "alpaca_fallback",
        },
        focus={"symbols": ["NVDA"], "reason": "Focus names came from the leader-priority list."},
    )

    assert summary["read_this_as"]["regime"] == "Market regime is UPTREND UNDER PRESSURE using the declared Alpaca fallback lane."
    assert summary["read_this_as"]["tape"] == "Tape is using the declared Alpaca fallback lane, not the live Schwab quote lane."
    assert "declared Alpaca fallback lane" in summary["read_this_as"]["breadth"]


def test_format_operator_text_prefers_shared_operator_payload():
    payload = {
        "operator_payload": {
            "artifact_family": "operator_payload",
            "schema_version": 1,
            "producer": module.MARKET_BRIEF_PRODUCER,
            "status": "ok",
            "generated_at": "2026-04-03T12:00:00+00:00",
            "known_at": "2026-04-03T12:00:00+00:00",
            "degraded_status": "healthy",
            "outcome_class": "healthy_candidates_found",
            "payload_key": "market_brief:1",
            "surface_type": "brief",
            "summary": {
                "headline": "OPEN: BUY | CONFIRMED UPTREND | size 100%",
                "what_this_means": "Trend is supportive enough to buy selective strength.",
                "read_this_as": {"session": "This is a regular session snapshot."},
            },
            "decision_contract_ref": {
                "artifact_family": "decision_state",
                "producer": module.MARKET_BRIEF_PRODUCER,
                "generated_at": "2026-04-03T12:00:00+00:00",
            },
            "source_refs": {
                "market_brief": {
                    "artifact_family": "market_brief",
                    "producer": module.MARKET_BRIEF_PRODUCER,
                    "generated_at": "2026-04-03T12:00:00+00:00",
                }
            },
            "health": {"status": "ok"},
            "warnings": [],
        }
    }

    text = module.format_operator_text(payload)

    assert "OPEN: BUY | CONFIRMED UPTREND | size 100%" in text
    assert "Status: healthy snapshot; machine inputs are aligned." in text


def test_describe_operator_status_distinguishes_safe_and_risky_degradation():
    assert (
        module.describe_operator_status({"outcome_class": "healthy_candidates_found", "degraded_status": "degraded_safe"})
        == "Status: degraded-safe snapshot; bounded fallback inputs are active."
    )
    assert (
        module.describe_operator_status({"outcome_class": "degraded_risky", "degraded_status": "degraded_risky"})
        == "Status: degraded-risky snapshot; live market inputs are missing or incomplete."
    )


def test_main_emits_json_payload(monkeypatch, capsys):
    payload = {
        "artifact_family": ARTIFACT_FAMILY_MARKET_BRIEF,
        "schema_version": ARTIFACT_SCHEMA_VERSION,
        "producer": module.MARKET_BRIEF_PRODUCER,
        "status": "ok",
        "outcome_class": "market_snapshot",
        "degraded_status": "healthy",
        "generated_at": "2026-04-03T12:00:00+00:00",
        "known_at": "2026-04-03T12:00:00+00:00",
        "freshness": {"regime_snapshot_age_seconds": 0.0, "polymarket_age_hours": 1.0, "tape_primary_source": "schwab"},
        "operator_summary": {"headline": "OPEN: WATCH | CORRECTION | size 0%", "what_this_means": "Stay selective.", "read_this_as": {}},
        "session": {"phase": "OPEN", "is_regular_hours": True},
        "warnings": [],
        "regime": {"display": "CORRECTION"},
        "posture": {"action": "WATCH"},
        "macro": {"state": "watch"},
        "tape": {"primary_source": "schwab"},
        "intraday_breadth": {"override_state": "inactive"},
        "focus": {"symbols": ["OXY"]},
    }
    monkeypatch.setattr(
        module,
        "parse_args",
        lambda: type(
            "Args",
            (),
            {"pretty": False, "operator": False, "output": None, "service_base_url": "http://service"},
        )(),
    )
    monkeypatch.setattr(module, "build_snapshot", lambda service_base_url="http://service": payload)

    module.main()

    rendered = json.loads(capsys.readouterr().out)
    assert rendered["artifact_family"] == ARTIFACT_FAMILY_MARKET_BRIEF
    assert rendered["producer"] == module.MARKET_BRIEF_PRODUCER
    assert rendered["status"] == "ok"


def test_build_operator_summary_uses_emergency_fallback_regime_wording():
    summary = module.build_operator_summary(
        session_phase="AFTER_HOURS",
        posture={"action": "NO_BUY", "reason": "Market inputs unavailable. Defaulting to defensive posture until fresh data is restored."},
        regime={
            "display": "CORRECTION",
            "position_sizing_pct": 0.0,
            "status": "degraded",
            "data_source": "unknown",
            "snapshot_age_seconds": 0.0,
        },
        tape={"primary_source": "cache"},
        macro={"state": "watch", "freshness_hours": 52.8},
        breadth={"override_state": "inactive", "override_reason": "outside regular market session"},
        focus={"symbols": ["OXY"], "reason": "Focus names came from the leader-priority list."},
    )

    regime_line = summary["read_this_as"]["regime"]
    assert "Fresh live regime is unavailable; using conservative emergency fallback." in regime_line
    assert "(0m old)" not in regime_line


def test_build_snapshot_uses_session_baseline_regime_premarket(monkeypatch):
    baseline = make_status(
        regime=MarketRegime.CORRECTION,
        notes="Stay defensive.",
        status="ok",
        data_source="cache",
        snapshot_age_seconds=14 * 3600,
    )
    monkeypatch.setattr(
        module,
        "load_last_known_regime_status",
        lambda cache_path=module.REGIME_CACHE_PATH, max_age_hours=None, session_baseline=False: baseline if session_baseline else baseline,
    )
    monkeypatch.setattr(
        module.TradingAdvisor,
        "get_market_status",
        lambda self, refresh=True: (_ for _ in ()).throw(AssertionError("live refresh should not run premarket")),
    )
    monkeypatch.setattr(
        module,
        "build_intraday_breadth_snapshot",
        lambda service_base_url="http://service": {
            "status": "inactive",
            "override_state": "inactive",
            "override_reason": "outside regular market session",
            "warnings": [],
        },
    )
    monkeypatch.setattr(module, "load_structured_context", lambda max_age_hours=30.0: None)
    monkeypatch.setattr(module, "load_last_known_macro_report", lambda max_age_hours=72.0: None)
    monkeypatch.setattr(module, "load_leader_priority_symbols", lambda max_age_hours=72.0: ["OXY"])
    monkeypatch.setattr(
        module,
        "fetch_tape_quotes",
        lambda service_base_url="http://service", symbols=module.TAPE_SYMBOLS: {
            "status": "error",
            "summary_line": "Tape unavailable",
            "risk_tone": "unknown",
            "primary_source": "unavailable",
            "symbols": [],
            "warnings": ["tape_fetch_failed: service unavailable"],
        },
    )
    monkeypatch.setattr(
        module,
        "load_cached_tape_quotes",
        lambda symbols=module.TAPE_SYMBOLS: {
            "status": "degraded",
            "summary_line": "SPY weak (-1.00%); QQQ weak (-1.50%); IWM unavailable; GLD unavailable. Risk tone defensive. Previous session fallback.",
            "risk_tone": "defensive",
            "primary_source": "cache",
            "symbols": [{"symbol": "SPY", "change_percent": -1.0}],
            "warnings": ["tape_previous_session_fallback"],
        },
    )

    snapshot = module.build_snapshot("http://service", now=module.datetime(2026, 4, 1, 8, 0, tzinfo=module.ZoneInfo("America/New_York")))

    assert snapshot["regime"]["status"] == "ok"
    assert snapshot["regime"]["notes"] == "Stay defensive."
    assert snapshot["posture"]["action"] == "NO_BUY"
    assert snapshot["outcome_class"] == "degraded_safe"
    assert snapshot["degraded_status"] == "degraded_safe"
    assert snapshot["session"]["phase"] == "PREMARKET"
    assert snapshot["tape"]["primary_source"] == "cache"
    assert "Previous session fallback" in snapshot["tape"]["summary_line"]
    assert snapshot["operator_summary"]["read_this_as"]["tape"] == "Tape is using previous-session fallback data, not fresh live quotes."
    assert snapshot["operator_summary"]["read_this_as"]["breadth"].startswith("Intraday breadth is inactive because")
    assert "market_regime_session_baseline:premarket" in snapshot["warnings"]


def test_build_snapshot_uses_stale_macro_report_outside_open_session(monkeypatch):
    monkeypatch.setattr(module.TradingAdvisor, "get_market_status", lambda self, refresh=True: make_status())
    monkeypatch.setattr(
        module,
        "build_intraday_breadth_snapshot",
        lambda service_base_url="http://service": {
            "status": "inactive",
            "override_state": "inactive",
            "override_reason": "outside regular market session",
            "warnings": [],
        },
    )
    monkeypatch.setattr(module, "load_structured_context", lambda max_age_hours=30.0: None)
    monkeypatch.setattr(
        module,
        "load_last_known_macro_report",
        lambda max_age_hours=72.0: {
            "summary": {
                "conviction": "neutral",
                "divergence": {"state": "watch", "summary": "Mixed theme watch"},
                "themeHighlights": [{"title": "Fed easing odds", "watchTickers": ["NVDA"]}],
            },
            "metadata": {"generatedAt": "2026-03-31T12:00:00Z"},
            "_stale_age_hours": 43.2,
        },
    )
    monkeypatch.setattr(module, "load_leader_priority_symbols", lambda max_age_hours=72.0: ["OXY"])
    monkeypatch.setattr(
        module,
        "requests",
        SimpleNamespace(
            get=lambda *args, **kwargs: SimpleNamespace(
                raise_for_status=lambda: None,
                json=lambda: {"data": {"items": []}},
            )
        ),
    )

    snapshot = module.build_snapshot("http://service", now=module.datetime(2026, 4, 1, 8, 0, tzinfo=module.ZoneInfo("America/New_York")))

    assert "[stale 43.2h]" in snapshot["macro"]["summary_line"]
    assert "polymarket_context_stale:43.2h" in snapshot["warnings"]


def test_build_snapshot_falls_back_conservatively_when_regime_fails(monkeypatch):
    monkeypatch.setattr(module, "maybe_self_heal_market_data_service", lambda service_base_url="http://service": {"attempted": False, "recovered": False, "reason": None})
    monkeypatch.setattr(module.TradingAdvisor, "get_market_status", lambda self, refresh=True: (_ for _ in ()).throw(RuntimeError("cooldown")))
    monkeypatch.setattr(
        module,
        "build_intraday_breadth_snapshot",
        lambda service_base_url="http://service": {
            "status": "inactive",
            "override_state": "inactive",
            "override_reason": "outside regular market session",
            "warnings": [],
        },
    )
    monkeypatch.setattr(module, "load_last_known_regime_status", lambda *args, **kwargs: None)
    monkeypatch.setattr(module, "load_structured_context", lambda max_age_hours=12.0: None)
    monkeypatch.setattr(module, "load_leader_priority_symbols", lambda max_age_hours=72.0: [])
    monkeypatch.setattr(
        module,
        "load_cached_tape_quotes",
        lambda symbols=module.TAPE_SYMBOLS: {
            "status": "error",
            "summary_line": "Previous-session tape fallback unavailable.",
            "risk_tone": "unknown",
            "primary_source": "unavailable",
            "symbols": [],
            "warnings": ["tape_cached_fallback_unavailable"],
        },
    )
    monkeypatch.setattr(
        module,
        "requests",
        SimpleNamespace(
            get=lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("service down"))
        ),
    )

    snapshot = module.build_snapshot(
        "http://service",
        now=module.datetime(2026, 4, 1, 12, 0, tzinfo=module.ZoneInfo("America/New_York")),
    )

    assert snapshot["artifact_family"] == ARTIFACT_FAMILY_MARKET_BRIEF
    assert snapshot["status"] == "degraded"
    assert snapshot["outcome_class"] == "degraded_risky"
    assert snapshot["degraded_status"] == "degraded_risky"
    assert snapshot["posture"]["action"] == "NO_BUY"
    assert "market_regime_unavailable" in snapshot["warnings"][0]
    assert snapshot["tape"]["risk_tone"] == "unknown"
    assert snapshot["posture"]["reason"] == (
        "Fresh live market data is unavailable (Schwab market data is in a brief cooldown). "
        "Defaulting to defensive posture until live data returns."
    )


def test_build_snapshot_softens_posture_when_tape_cache_survives_regime_emergency_fallback(monkeypatch):
    monkeypatch.setattr(module, "maybe_self_heal_market_data_service", lambda service_base_url="http://service": {"attempted": False, "recovered": False, "reason": None})
    monkeypatch.setattr(
        module.TradingAdvisor,
        "get_market_status",
        lambda self, refresh=True: (_ for _ in ()).throw(RuntimeError("service: Schwab REST cooldown open until 2026-04-01T13:59:29Z")),
    )
    monkeypatch.setattr(
        module,
        "build_intraday_breadth_snapshot",
        lambda service_base_url="http://service": {
            "status": "inactive",
            "override_state": "inactive",
            "override_reason": "outside regular market session",
            "warnings": [],
        },
    )
    monkeypatch.setattr(module, "load_last_known_regime_status", lambda *args, **kwargs: None)
    monkeypatch.setattr(module, "load_structured_context", lambda max_age_hours=12.0: None)
    monkeypatch.setattr(module, "load_last_known_macro_report", lambda max_age_hours=72.0: None)
    monkeypatch.setattr(module, "load_leader_priority_symbols", lambda max_age_hours=72.0: ["OXY"])
    monkeypatch.setattr(
        module,
        "fetch_tape_quotes",
        lambda service_base_url="http://service", symbols=module.TAPE_SYMBOLS: {
            "status": "error",
            "summary_line": "Tape unavailable",
            "risk_tone": "unknown",
            "primary_source": "unavailable",
            "symbols": [],
            "warnings": ["tape_fetch_failed: service unavailable"],
        },
    )
    monkeypatch.setattr(
        module,
        "load_cached_tape_quotes",
        lambda symbols=module.TAPE_SYMBOLS: {
            "status": "degraded",
            "summary_line": "SPY weak (-1.00%); QQQ weak (-1.50%); IWM unavailable; GLD unavailable. Risk tone defensive. Previous session fallback.",
            "risk_tone": "defensive",
            "primary_source": "cache",
            "symbols": [{"symbol": "SPY", "change_percent": -1.0}],
            "warnings": ["tape_previous_session_fallback"],
        },
    )

    snapshot = module.build_snapshot(
        "http://service",
        now=module.datetime(2026, 4, 1, 8, 0, tzinfo=module.ZoneInfo("America/New_York")),
    )

    assert snapshot["posture"]["action"] == "NO_BUY"
    assert snapshot["tape"]["primary_source"] == "cache"
    assert snapshot["posture"]["reason"] == (
        "Fresh live market regime is unavailable (Schwab market data is in a brief cooldown). "
        "Using previous-session market context and "
        "staying defensive until live data returns."
    )


def test_maybe_self_heal_market_data_service_restarts_local_service_once(monkeypatch):
    probes = iter(
        [
            {"reachable": False, "status_code": None, "reason": "connection refused"},
            {"reachable": True, "status_code": 200, "reason": None},
        ]
    )
    launch_calls: list[list[str]] = []

    monkeypatch.setattr(module, "probe_market_data_service", lambda service_base_url="http://localhost:3033": next(probes))
    monkeypatch.setattr(module, "is_local_service_base_url", lambda service_base_url: True)
    monkeypatch.setattr(module.time, "sleep", lambda *_args, **_kwargs: None)

    def _fake_run(cmd, capture_output, text, timeout, check):
        launch_calls.append(cmd)
        return SimpleNamespace(returncode=0, stderr="", stdout="")

    monkeypatch.setattr(module.subprocess, "run", _fake_run)

    result = module.maybe_self_heal_market_data_service("http://127.0.0.1:3033")

    assert result == {"attempted": True, "recovered": True, "reason": None}
    assert launch_calls == [["launchctl", "kickstart", "-k", f"gui/{module.os.getuid()}/{module.MARKET_DATA_LAUNCHD_LABEL}"]]


def test_build_snapshot_uses_last_known_regime_snapshot_when_live_fetch_fails(monkeypatch):
    monkeypatch.setattr(module.TradingAdvisor, "get_market_status", lambda self, refresh=True: (_ for _ in ()).throw(RuntimeError("cooldown")))
    monkeypatch.setattr(
        module,
        "build_intraday_breadth_snapshot",
        lambda service_base_url="http://service": {
            "status": "degraded",
            "override_state": "unavailable",
            "override_reason": "live breadth inputs are stale or incomplete",
            "warnings": ["s_and_p_coverage_too_low"],
        },
    )
    monkeypatch.setattr(
        module,
        "load_last_known_regime_status",
        lambda *args, **kwargs: make_status(
            regime=MarketRegime.CORRECTION,
            notes="Regime score -8: stay defensive. [LAST KNOWN SNAPSHOT 18.0h old]",
            status="degraded",
            degraded_reason="Using last known snapshot.",
            snapshot_age_seconds=18 * 3600,
            regime_score=-8,
            distribution_days=9,
        ),
    )
    monkeypatch.setattr(module, "load_structured_context", lambda max_age_hours=30.0: None)
    monkeypatch.setattr(module, "load_leader_priority_symbols", lambda max_age_hours=72.0: ["OXY"])
    monkeypatch.setattr(
        module,
        "requests",
        SimpleNamespace(
            get=lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("service down"))
        ),
    )

    snapshot = module.build_snapshot(
        "http://service",
        now=module.datetime(2026, 4, 1, 12, 0, tzinfo=module.ZoneInfo("America/New_York")),
    )

    assert snapshot["regime"]["distribution_days"] == 9
    assert snapshot["posture"]["action"] == "NO_BUY"
    assert "market_regime_stale_cache" in snapshot["warnings"][0]
    assert "intraday_breadth_s_and_p_coverage_too_low" in snapshot["warnings"]
