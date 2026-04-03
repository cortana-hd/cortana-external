from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pre_open_canary as module


class _FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self) -> dict:
        return self._payload


def test_build_canary_payload_passes_when_all_checks_are_healthy(monkeypatch):
    def fake_get(url: str, timeout: int = 10):
        if url.endswith("/market-data/ready"):
            return _FakeResponse({"data": {"ready": True, "operatorState": "healthy", "operatorAction": ""}})
        if url.endswith("/market-data/ops"):
            return _FakeResponse(
                {
                    "data": {
                        "health": {"providers": {"schwab": "configured", "schwabTokenStatus": "ready", "providerMetrics": {}}},
                        "serviceOperatorState": "healthy",
                        "serviceOperatorAction": "",
                    }
                }
            )
        if "/market-data/quote/batch" in url:
            return _FakeResponse(
                {
                    "data": {
                        "items": [
                            {"symbol": "SPY", "status": "ok", "source": "schwab"},
                            {"symbol": "QQQ", "status": "ok", "source": "schwab"},
                        ]
                    }
                }
            )
        raise AssertionError(f"unexpected url {url}")

    monkeypatch.setattr(module.requests, "get", fake_get)
    monkeypatch.setattr(
        module.TradingAdvisor,
        "get_market_status",
        lambda self, refresh=True: SimpleNamespace(status="ok", data_source="schwab", snapshot_age_seconds=0.0, notes="trend intact"),
    )
    monkeypatch.setattr(
        module.canslim_alert,
        "build_alert_payload",
        lambda **kwargs: {
            "status": "ok",
            "degraded_status": "healthy",
            "outcome_class": "healthy_no_candidates",
            "summary": {"scanned": 12, "evaluated": 8},
        },
    )

    payload = module.build_canary_payload(
        service_base_url="http://service",
        quote_symbols=("SPY", "QQQ"),
        strategy_limit=2,
        strategy_universe_size=12,
    )

    assert payload["artifact_family"] == "readiness_check"
    assert payload["result"] == "pass"
    assert payload["ready_for_open"] is True
    assert payload["status"] == "ok"
    assert payload["outcome_class"] == "readiness_pass"


def test_build_canary_payload_warns_on_provider_cooldown(monkeypatch):
    def fake_get(url: str, timeout: int = 10):
        if url.endswith("/market-data/ready"):
            return _FakeResponse({"data": {"ready": True, "operatorState": "provider_cooldown", "operatorAction": "wait"}})
        if url.endswith("/market-data/ops"):
            return _FakeResponse(
                {
                    "data": {
                        "health": {"providers": {"schwab": "configured", "schwabTokenStatus": "ready", "providerMetrics": {}}},
                        "serviceOperatorState": "provider_cooldown",
                        "serviceOperatorAction": "wait",
                    }
                }
            )
        if "/market-data/quote/batch" in url:
            raise RuntimeError("503 Server Error: Service Unavailable")
        raise AssertionError(f"unexpected url {url}")

    monkeypatch.setattr(module.requests, "get", fake_get)
    monkeypatch.setattr(
        module.TradingAdvisor,
        "get_market_status",
        lambda self, refresh=True: SimpleNamespace(status="degraded", data_source="cache", snapshot_age_seconds=120.0, notes="cached fallback", degraded_reason="cooldown"),
    )
    monkeypatch.setattr(
        module.canslim_alert,
        "build_alert_payload",
        lambda **kwargs: {
            "status": "degraded",
            "degraded_status": "degraded_safe",
            "outcome_class": "market_gate_blocked",
            "summary": {"scanned": 12, "evaluated": 8},
        },
    )

    payload = module.build_canary_payload(
        service_base_url="http://service",
        quote_symbols=("SPY", "QQQ"),
        strategy_limit=2,
        strategy_universe_size=12,
    )

    assert payload["result"] == "warn"
    assert payload["ready_for_open"] is False
    assert payload["status"] == "degraded"
    assert payload["degraded_status"] == "degraded_safe"
    assert payload["outcome_class"] == "readiness_warn"


def test_build_canary_payload_fails_when_auth_needs_operator_action(monkeypatch):
    def fake_get(url: str, timeout: int = 10):
        if url.endswith("/market-data/ready"):
            return _FakeResponse({"data": {"ready": False, "operatorState": "human_action_required", "operatorAction": "reauthorize"}})
        if url.endswith("/market-data/ops"):
            return _FakeResponse(
                {
                    "data": {
                        "health": {
                            "providers": {
                                "schwab": "configured",
                                "schwabTokenStatus": "human_action_required",
                                "schwabTokenReason": "refresh token expired",
                                "providerMetrics": {},
                            }
                        },
                        "serviceOperatorState": "human_action_required",
                        "serviceOperatorAction": "reauthorize",
                    }
                }
            )
        if "/market-data/quote/batch" in url:
            raise AssertionError("quote smoke should not run after hard failure")
        raise AssertionError(f"unexpected url {url}")

    monkeypatch.setattr(module.requests, "get", fake_get)
    monkeypatch.setattr(
        module.TradingAdvisor,
        "get_market_status",
        lambda self, refresh=True: SimpleNamespace(status="ok", data_source="schwab", snapshot_age_seconds=0.0, notes="trend intact"),
    )
    monkeypatch.setattr(
        module.canslim_alert,
        "build_alert_payload",
        lambda **kwargs: {
            "status": "ok",
            "degraded_status": "healthy",
            "outcome_class": "healthy_no_candidates",
            "summary": {"scanned": 12, "evaluated": 8},
        },
    )

    payload = module.build_canary_payload(
        service_base_url="http://service",
        quote_symbols=("SPY", "QQQ"),
        strategy_limit=2,
        strategy_universe_size=12,
    )

    assert payload["result"] == "fail"
    assert payload["ready_for_open"] is False
    assert payload["status"] == "error"
    assert payload["degraded_status"] == "degraded_risky"
    assert payload["outcome_class"] == "readiness_fail"


def test_main_writes_default_output_and_exits_nonzero_when_pass_is_required(monkeypatch, tmp_path, capsys):
    payload = {
        "artifact_family": "readiness_check",
        "schema_version": 1,
        "producer": "backtester.pre_open_canary",
        "status": "degraded",
        "degraded_status": "degraded_safe",
        "outcome_class": "readiness_warn",
        "generated_at": "2026-04-03T12:00:00+00:00",
        "known_at": "2026-04-03T12:00:00+00:00",
        "check_name": "pre_open_canary",
        "result": "warn",
        "ready_for_open": False,
        "checked_at": "2026-04-03T12:00:00+00:00",
        "checks": [{"name": "service_ready", "result": "warn", "evidence": {}}],
        "warnings": ["service_ready:provider_cooldown"],
    }
    output_path = tmp_path / "pre-open-canary-latest.json"
    monkeypatch.setattr(
        module,
        "parse_args",
        lambda: SimpleNamespace(
            service_base_url="http://service",
            output=output_path,
            pretty=False,
            operator=True,
            require_pass=True,
            quote_symbols="SPY,QQQ",
            strategy_limit=2,
            strategy_universe_size=12,
        ),
    )
    monkeypatch.setattr(module, "build_canary_payload", lambda **kwargs: payload)

    try:
        module.main()
    except SystemExit as exc:
        assert exc.code == 1
    else:
        raise AssertionError("expected SystemExit")

    assert "Pre-open canary: WARN" in capsys.readouterr().out
    assert json.loads(output_path.read_text(encoding="utf-8"))["result"] == "warn"
