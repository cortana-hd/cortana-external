# Data module - for fetching and managing historical price data
from pathlib import Path

from dotenv import load_dotenv

# Auto-load repo-level .env for local script runs (advisor/dipbuyer/risk signals).
# Does not override already-exported environment variables.
_REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_REPO_ROOT / ".env", override=False)

from .fetcher import (
    AlpacaDataFetcher,
    get_historical_data,
    get_multiple_symbols,
    get_spy_benchmark,
)
from .fundamentals import FundamentalsCache, FundamentalsFetcher
from .market_regime import MarketRegime, MarketRegimeDetector, MarketStatus
from .universe import GROWTH_WATCHLIST, SP500_TICKERS, UniverseScreener
