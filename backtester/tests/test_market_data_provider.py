from __future__ import annotations

from datetime import datetime

import pandas as pd

from data.market_data_provider import MarketDataError, MarketDataProvider


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
    cache_path.write_text(
        """
{
  "schema_version": 1,
  "symbol": "SPY",
  "period": "90d",
  "source": "schwab",
  "generated_at_utc": "2026-03-22T00:00:00+00:00",
  "rows": [
    {"date": "2026-03-07T00:00:00-05:00", "Open": 1, "High": 2, "Low": 0.5, "Close": 1.5, "Volume": 10},
    {"date": "2026-03-10T00:00:00-04:00", "Open": 2, "High": 3, "Low": 1.5, "Close": 2.5, "Volume": 11}
  ]
}
""".strip(),
        encoding="utf-8",
    )

    cached = provider._read_cache("SPY", "90d")

    assert cached is not None
    frame, source, _ = cached
    assert source == "schwab"
    assert len(frame) == 2
