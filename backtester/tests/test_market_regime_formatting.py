from data.market_regime import MarketRegime, MarketStatus
from data.market_regime import MarketRegimeDetector
import pandas as pd


def test_market_status_box_expands_for_long_lines():
    status = MarketStatus(
        regime=MarketRegime.CORRECTION,
        distribution_days=6,
        last_ftd="None recent",
        trend_direction="down",
        position_sizing=0.0,
        notes="Regime score -7: 6 distribution days and -5.9% drawdown. Stay defensive.",
        data_source="schwab",
        status="ok",
        regime_score=-7,
        drawdown_pct=-5.9,
        recent_return_pct=-5.3,
    )

    text = str(status).strip("\n")
    lines = text.splitlines()

    assert lines[0].startswith("╔")
    assert lines[-1].startswith("╚")
    assert all(line.endswith("╗") for line in lines[:1])
    assert all(line.endswith("╣") for line in lines[2:3])
    assert all(line.endswith("║") for line in lines[1:-1] if line.startswith("║"))
    assert "Notes: Regime score -7: 6 distribution days and -5.9% drawdown. Stay defensive." in text


def test_market_status_renders_premarket_futures_summary():
    status = MarketStatus(
        regime=MarketRegime.CORRECTION,
        distribution_days=6,
        last_ftd="None recent",
        trend_direction="down",
        position_sizing=0.0,
        notes="Stay defensive.",
        data_source="schwab",
        status="ok",
        regime_score=-7,
        drawdown_pct=-5.9,
        recent_return_pct=-5.3,
        premarket_futures_summary="supportive | /ES +0.42% | /NQ +0.51%",
    )

    assert "Premarket futures: supportive | /ES +0.42% | /NQ +0.51%" in str(status)


def test_distribution_calendar_note_explains_missing_latest_day():
    detector = MarketRegimeDetector()
    detector._data = pd.DataFrame(
        {
            "Close": [100.0, 99.0, 99.4],
            "Volume": [1000, 1200, 1100],
        },
        index=pd.to_datetime(["2026-03-20", "2026-03-23", "2026-03-24"]),
    )

    note = detector.get_distribution_calendar_note(lookback=25)

    assert note == "2026-03-24 is not listed because it did not qualify as a distribution day."
