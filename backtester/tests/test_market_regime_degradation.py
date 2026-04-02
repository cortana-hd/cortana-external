from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import pandas as pd

from data.market_data_provider import MarketDataError, MarketHistoryResult
from data.market_regime import MarketDataFetchError, MarketRegime, MarketRegimeDetector


def _write_snapshot(path: Path, *, generated_at: datetime) -> None:
    payload = {
        "schema_version": 1,
        "symbol": "SPY",
        "generated_at_utc": generated_at.isoformat(),
        "ttl_seconds": 1800,
        "market_status": {
            "regime": MarketRegime.CORRECTION.value,
            "distribution_days": 6,
            "last_ftd": "2026-02-20",
            "trend_direction": "down",
            "position_sizing": 0.0,
            "notes": "Cached correction snapshot.",
            "data_source": "alpaca",
        },
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _history_frame(days: int = 90) -> pd.DataFrame:
    index = pd.date_range(end=datetime.now(timezone.utc), periods=days, freq="B")
    closes = [100 + i * 0.6 for i in range(days)]
    return pd.DataFrame(
        {
            "Open": closes,
            "High": [value + 1.0 for value in closes],
            "Low": [value - 1.0 for value in closes],
            "Close": closes,
            "Volume": [1_000_000 + (i * 1_000) for i in range(days)],
        },
        index=index,
    )


def test_rate_limit_uses_fresh_cache_and_returns_degraded_status(tmp_path):
    cache_path = tmp_path / "market_snapshot.json"
    _write_snapshot(cache_path, generated_at=datetime.now(timezone.utc) - timedelta(minutes=10))

    detector = MarketRegimeDetector(cache_path=str(cache_path), cache_ttl_seconds=1800)
    detector.data_provider.get_history = lambda *args, **kwargs: (_ for _ in ()).throw(MarketDataError("rate limit", transient=True))  # type: ignore[method-assign]

    status = detector.get_status()

    assert status.status == "degraded"
    assert status.regime == MarketRegime.CORRECTION
    assert status.data_source == "cache"
    assert status.snapshot_age_seconds > 0


def test_stale_cache_within_bounded_window_returns_degraded_status(tmp_path):
    cache_path = tmp_path / "market_snapshot.json"
    _write_snapshot(cache_path, generated_at=datetime.now(timezone.utc) - timedelta(hours=3))

    detector = MarketRegimeDetector(cache_path=str(cache_path), cache_ttl_seconds=60)
    detector.data_provider.get_history = lambda *args, **kwargs: (_ for _ in ()).throw(MarketDataError("rate limit", transient=True))  # type: ignore[method-assign]

    status = detector.get_status()

    assert status.status == "degraded"
    assert "bounded fallback window" in status.degraded_reason


def test_default_market_regime_fallback_window_covers_multi_day_snapshot(tmp_path):
    cache_path = tmp_path / "market_snapshot.json"
    _write_snapshot(cache_path, generated_at=datetime.now(timezone.utc) - timedelta(hours=48))

    detector = MarketRegimeDetector(cache_path=str(cache_path), cache_ttl_seconds=60)
    detector.data_provider.get_history = lambda *args, **kwargs: (_ for _ in ()).throw(MarketDataError("provider cooldown", transient=True))  # type: ignore[method-assign]

    status = detector.get_status()

    assert status.status == "degraded"
    assert status.data_source == "cache"
    assert status.snapshot_age_seconds >= 48 * 3600 - 60


def test_too_stale_cache_still_raises_with_staleness_message(tmp_path):
    cache_path = tmp_path / "market_snapshot.json"
    _write_snapshot(cache_path, generated_at=datetime.now(timezone.utc) - timedelta(hours=200))

    detector = MarketRegimeDetector(cache_path=str(cache_path), cache_ttl_seconds=60)
    detector.data_provider.get_history = lambda *args, **kwargs: (_ for _ in ()).throw(MarketDataError("rate limit", transient=True))  # type: ignore[method-assign]

    with pytest.raises(MarketDataFetchError) as exc_info:
        detector.get_status()

    msg = str(exc_info.value).lower()
    assert "stale" in msg
    assert "max_fallback=168.0h" in msg


def test_missing_cache_uses_conservative_emergency_status(tmp_path):
    cache_path = tmp_path / "market_snapshot.json"

    detector = MarketRegimeDetector(cache_path=str(cache_path), cache_ttl_seconds=1800)
    detector.data_provider.get_history = lambda *args, **kwargs: (_ for _ in ()).throw(MarketDataError("service unavailable", transient=True))  # type: ignore[method-assign]

    status = detector.get_status()

    assert status.status == "degraded"
    assert status.regime == MarketRegime.CORRECTION
    assert status.data_source == "unknown"
    assert status.position_sizing == 0.0
    assert "emergency fallback" in status.degraded_reason.lower()


def test_retries_transient_market_regime_history_before_succeeding(tmp_path, monkeypatch):
    detector = MarketRegimeDetector(
        cache_path=str(tmp_path / "market_snapshot.json"),
        transient_retry_attempts=2,
        transient_retry_backoff_seconds=1.25,
    )
    frame = _history_frame()
    attempts = {"count": 0}
    sleeps: list[float] = []

    def _history(*args, **kwargs):
        attempts["count"] += 1
        if attempts["count"] < 3:
            raise MarketDataError("provider cooldown", transient=True)
        return MarketHistoryResult(frame=frame, source="schwab")

    monkeypatch.setattr(detector.data_provider, "get_history", _history)
    monkeypatch.setattr("data.market_regime.time.sleep", lambda seconds: sleeps.append(seconds))

    status = detector.get_status()

    assert attempts["count"] == 3
    assert sleeps[:2] == [1.25, 2.5]
    assert status.status == "ok"


def test_degraded_history_fetch_marks_market_status_degraded(tmp_path, monkeypatch):
    detector = MarketRegimeDetector(cache_path=str(tmp_path / "market_snapshot.json"))
    monkeypatch.setattr(
        detector.data_provider,
        "get_history",
        lambda *args, **kwargs: MarketHistoryResult(
            frame=_history_frame(),
            source="cache",
            status="degraded",
            degraded_reason="Live providers unavailable; using stale cached data (7200s old, original_source=schwab, beyond live TTL but within bounded fallback window).",
            staleness_seconds=7200.0,
        ),
    )

    status = detector.get_status()

    assert status.status == "degraded"
    assert status.data_source == "cache"
    assert "cached history" in status.notes
    assert "bounded fallback window" in status.degraded_reason
    assert status.snapshot_age_seconds == 7200.0
