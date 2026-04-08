from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pandas as pd
import requests
import pytest

from data.market_data_provider import (
    DEFAULT_MARKET_DATA_CACHE_DIR,
    MarketDataError,
    MarketDataProvider,
)


def _frame() -> pd.DataFrame:
    idx = pd.date_range(end=datetime.now(), periods=5, freq="D")
    return pd.DataFrame(
        {
            "Open": [1, 2, 3, 4, 5],
            "High": [1, 2, 3, 4, 5],
            "Low": [1, 2, 3, 4, 5],
            "Close": [1, 2, 3, 4, 5],
            "Volume": [10, 11, 12, 13, 14],
        },
        index=idx,
    )


def test_service_provider_happy_path(tmp_path):
    provider = MarketDataProvider(cache_dir=str(tmp_path), max_retries=0)
    expected = _frame()

    provider._fetch_service_history = lambda symbol, period, auto_adjust=False: (  # type: ignore[method-assign]
        expected,
        {"source": "schwab", "status": "ok", "degradedReason": "", "stalenessSeconds": 0.0},
    )
    result = provider.get_history("SPY", period="1y")

    assert result.source == "schwab"
    assert result.status == "ok"
    assert not result.frame.empty


def test_default_cache_dir_is_backtester_relative_not_cwd(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("MARKET_DATA_CACHE_DIR", raising=False)

    provider = MarketDataProvider(max_retries=0)

    assert provider.cache_dir == DEFAULT_MARKET_DATA_CACHE_DIR
    assert provider.cache_dir.is_absolute()


def test_service_metadata_and_status_passthrough(tmp_path):
    provider = MarketDataProvider(cache_dir=str(tmp_path), max_retries=0)
    expected = _frame()
    provider._fetch_service_history = lambda symbol, period, auto_adjust=False: (  # type: ignore[method-assign]
        expected,
        {
            "source": "service",
            "status": "degraded",
            "degradedReason": "using fallback quote",
            "stalenessSeconds": 12.0,
        },
    )

    result = provider.get_history("SPY", period="1y")

    assert result.source == "service"
    assert result.status == "degraded"
    assert result.degraded_reason == "using fallback quote"
    assert result.staleness_seconds == 12.0


def test_degraded_cache_path_when_live_providers_fail(tmp_path):
    provider = MarketDataProvider(cache_dir=str(tmp_path), cache_ttl_seconds=1800, max_retries=0)
    cached_df = _frame()
    provider._write_cache("SPY", "1y", "schwab", cached_df)

    def _fail(*args, **kwargs):
        raise MarketDataError("rate limit", transient=True)

    provider._fetch_service_history = _fail  # type: ignore[method-assign]

    result = provider.get_history("SPY", period="1y")

    assert result.source == "cache"
    assert result.status == "degraded"
    assert "cached" in result.degraded_reason.lower()


def test_stale_cache_within_bounded_window_is_used_for_transient_failures(tmp_path):
    provider = MarketDataProvider(
        cache_dir=str(tmp_path),
        cache_ttl_seconds=60,
        max_retries=0,
        stale_fallback_max_age_hours=24,
    )
    cache_path = tmp_path / "SPY_90d.json"
    cache_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "symbol": "SPY",
                "period": "90d",
                "source": "schwab",
                "generated_at_utc": (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(),
                "rows": [
                    {
                        "date": idx.isoformat(),
                        "Open": float(row["Open"]),
                        "High": float(row["High"]),
                        "Low": float(row["Low"]),
                        "Close": float(row["Close"]),
                        "Volume": float(row["Volume"]),
                    }
                    for idx, row in _frame().iterrows()
                ],
            }
        ),
        encoding="utf-8",
    )

    provider._fetch_service_history = lambda *args, **kwargs: (_ for _ in ()).throw(MarketDataError("provider cooldown", transient=True))  # type: ignore[method-assign]
    result = provider.get_history("SPY", period="90d")

    assert result.source == "cache"
    assert result.status == "degraded"
    assert "bounded fallback window" in result.degraded_reason


def test_default_stale_cache_window_covers_multi_day_trading_scan_fallback(tmp_path):
    provider = MarketDataProvider(
        cache_dir=str(tmp_path),
        cache_ttl_seconds=60,
        max_retries=0,
    )
    cache_path = tmp_path / "ABBV_6mo.json"
    cache_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "symbol": "ABBV",
                "period": "6mo",
                "source": "schwab",
                "generated_at_utc": (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat(),
                "rows": [
                    {
                        "date": idx.isoformat(),
                        "Open": float(row["Open"]),
                        "High": float(row["High"]),
                        "Low": float(row["Low"]),
                        "Close": float(row["Close"]),
                        "Volume": float(row["Volume"]),
                    }
                    for idx, row in _frame().iterrows()
                ],
            }
        ),
        encoding="utf-8",
    )

    provider._fetch_service_history = lambda *args, **kwargs: (_ for _ in ()).throw(MarketDataError("provider cooldown", transient=True))  # type: ignore[method-assign]
    result = provider.get_history("ABBV", period="6mo")

    assert result.source == "cache"
    assert result.status == "degraded"
    assert result.staleness_seconds >= 48 * 3600 - 60


def test_compatible_longer_period_cache_is_used_for_shorter_request(tmp_path):
    provider = MarketDataProvider(
        cache_dir=str(tmp_path),
        cache_ttl_seconds=60,
        max_retries=0,
        stale_fallback_max_age_hours=24,
    )
    frame = pd.DataFrame(
        {
            "Open": [1, 2, 3, 4, 5, 6],
            "High": [1, 2, 3, 4, 5, 6],
            "Low": [1, 2, 3, 4, 5, 6],
            "Close": [1, 2, 3, 4, 5, 6],
            "Volume": [10, 11, 12, 13, 14, 15],
        },
        index=pd.date_range(end=datetime.now(timezone.utc), periods=6, freq="30D"),
    )
    cache_path = tmp_path / "ABBV_1y.json"
    cache_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "symbol": "ABBV",
                "period": "1y",
                "source": "schwab",
                "generated_at_utc": (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(),
                "rows": [
                    {
                        "date": idx.isoformat(),
                        "Open": float(row["Open"]),
                        "High": float(row["High"]),
                        "Low": float(row["Low"]),
                        "Close": float(row["Close"]),
                        "Volume": float(row["Volume"]),
                    }
                    for idx, row in frame.iterrows()
                ],
            }
        ),
        encoding="utf-8",
    )

    provider._fetch_service_history = lambda *args, **kwargs: (_ for _ in ()).throw(MarketDataError("provider cooldown", transient=True))  # type: ignore[method-assign]
    result = provider.get_history("ABBV", period="6mo")

    assert result.source == "cache"
    assert result.status == "degraded"
    assert "1y -> 6mo" in result.degraded_reason
    assert not result.frame.empty


def test_stale_cache_beyond_bounded_window_is_not_used(tmp_path):
    provider = MarketDataProvider(
        cache_dir=str(tmp_path),
        cache_ttl_seconds=60,
        max_retries=0,
        stale_fallback_max_age_hours=1,
    )
    cache_path = tmp_path / "SPY_90d.json"
    cache_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "symbol": "SPY",
                "period": "90d",
                "source": "schwab",
                "generated_at_utc": (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat(),
                "rows": [
                    {
                        "date": idx.isoformat(),
                        "Open": float(row["Open"]),
                        "High": float(row["High"]),
                        "Low": float(row["Low"]),
                        "Close": float(row["Close"]),
                        "Volume": float(row["Volume"]),
                    }
                    for idx, row in _frame().iterrows()
                ],
            }
        ),
        encoding="utf-8",
    )

    provider._fetch_service_history = lambda *args, **kwargs: (_ for _ in ()).throw(MarketDataError("provider cooldown", transient=True))  # type: ignore[method-assign]

    with pytest.raises(MarketDataError) as exc:
        provider.get_history("SPY", period="90d")

    assert "provider cooldown" in str(exc.value)


def test_fallback_between_supported_providers_defaults_to_service(tmp_path):
    provider = MarketDataProvider(provider_order="alpaca,schwab", cache_dir=str(tmp_path), cache_ttl_seconds=0, max_retries=0)
    expected = _frame()
    calls: list[str | None] = []

    def _legacy_service(*args, **kwargs):
        calls.append(kwargs.get("provider"))
        if len(calls) == 1:
            raise MarketDataError("legacy primary failed", transient=True)
        return (
            expected,
            {"source": "schwab", "status": "ok", "degradedReason": "", "stalenessSeconds": 0.0},
        )

    provider._fetch_service_history = _legacy_service  # type: ignore[method-assign]
    result = provider.get_history("SPY", period="1y")

    assert calls == ["alpaca", "schwab"]
    assert result.source == "schwab"


def test_quote_happy_path(tmp_path):
    provider = MarketDataProvider(cache_dir=str(tmp_path), max_retries=0)
    provider._fetch_service_quote = lambda symbol, provider=None: (  # type: ignore[method-assign]
        {"symbol": "/ES", "price": 5200.25, "changePercent": 0.42},
        {"source": "schwab_streamer", "status": "ok", "degradedReason": "", "stalenessSeconds": 0.0},
    )

    result = provider.get_quote("/ES")

    assert result.source == "schwab_streamer"
    assert result.quote["symbol"] == "/ES"
    assert result.quote["price"] == 5200.25


def test_cache_read_handles_mixed_timezone_rows(tmp_path):
    provider = MarketDataProvider(cache_dir=str(tmp_path), cache_ttl_seconds=999999, max_retries=0)
    cache_path = tmp_path / "SPY_90d.json"
    generated_at = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    cache_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "symbol": "SPY",
                "period": "90d",
                "source": "schwab",
                "generated_at_utc": generated_at,
                "rows": [
                    {"date": "2026-03-07T00:00:00-05:00", "Open": 1, "High": 2, "Low": 0.5, "Close": 1.5, "Volume": 10},
                    {"date": "2026-03-10T00:00:00-04:00", "Open": 2, "High": 3, "Low": 1.5, "Close": 2.5, "Volume": 11},
                ],
            }
        ),
        encoding="utf-8",
    )

    cached = provider._read_cache("SPY", "90d")

    assert cached is not None
    frame, source, _ = cached
    assert source == "schwab"
    assert len(frame) == 2


def test_build_frame_from_nested_service_rows():
    payload = {
        "source": "schwab",
        "status": "ok",
        "data": {
            "symbol": "SPY",
            "period": "90d",
            "interval": "1d",
            "rows": [
                {
                    "timestamp": "2026-03-20T05:00:00.000Z",
                    "open": 656.51,
                    "high": 656.69,
                    "low": 644.72,
                    "close": 648.57,
                    "volume": 163617522,
                },
                {
                    "timestamp": "2026-03-23T05:00:00.000Z",
                    "open": 649.0,
                    "high": 655.5,
                    "low": 648.25,
                    "close": 654.94,
                    "volume": 134460396,
                },
            ],
        },
    }

    frame = MarketDataProvider._build_frame_from_service_payload(payload, symbol="SPY")

    assert len(frame) == 2
    assert float(frame.iloc[-1]["Close"]) == 654.94


def test_service_error_reason_is_extracted_from_degraded_payload(tmp_path, monkeypatch):
    provider = MarketDataProvider(cache_dir=str(tmp_path), max_retries=0)

    response = requests.Response()
    response.status_code = 503
    response._content = b'{"source":"service","status":"error","degradedReason":"CoinMarketCap historical quotes are not available on the configured API plan","data":{"error":"rows unavailable"}}'
    response.headers["Content-Type"] = "application/json"

    monkeypatch.setattr("data.market_data_provider.requests.get", lambda *args, **kwargs: response)

    with pytest.raises(MarketDataError) as exc:
        provider.get_history("BTC-USD", period="6mo")

    assert "CoinMarketCap historical quotes are not available on the configured API plan" in str(exc.value)
