from __future__ import annotations

from data.fundamentals import FundamentalsCache, FundamentalsFetcher


class _StubClient:
    def __init__(self, payload):
        self.payload = payload

    def get_symbol_payload(self, route, symbol, params=None):
        return {"status": "ok", "data": self.payload}

    @staticmethod
    def extract_data(payload):
        return payload.get("data")


def test_get_annual_eps_growth_uses_requested_year_horizon_when_earnings_history_exists(tmp_path):
    fetcher = FundamentalsFetcher(service_client=_StubClient(
        {
            "annual_eps_growth": 99.0,
            "earnings_history": [
                {"date": "2021-03-31", "eps_actual": 1.0},
                {"date": "2021-06-30", "eps_actual": 1.0},
                {"date": "2021-09-30", "eps_actual": 1.0},
                {"date": "2021-12-31", "eps_actual": 1.0},
                {"date": "2022-03-31", "eps_actual": 1.25},
                {"date": "2022-06-30", "eps_actual": 1.25},
                {"date": "2022-09-30", "eps_actual": 1.25},
                {"date": "2022-12-31", "eps_actual": 1.25},
                {"date": "2023-03-31", "eps_actual": 1.5625},
                {"date": "2023-06-30", "eps_actual": 1.5625},
                {"date": "2023-09-30", "eps_actual": 1.5625},
                {"date": "2023-12-31", "eps_actual": 1.5625},
            ],
        }
    ))
    fetcher.cache = FundamentalsCache(cache_dir=str(tmp_path / "fundamentals-a"))

    growth = fetcher.get_annual_eps_growth("AAPL3Y", years=3)

    assert growth is not None
    assert round(growth, 2) == 16.04


def test_get_annual_eps_growth_only_uses_service_summary_for_default_horizon(tmp_path):
    fetcher = FundamentalsFetcher(service_client=_StubClient({"annual_eps_growth": 18.5, "earnings_history": []}))
    fetcher.cache = FundamentalsCache(cache_dir=str(tmp_path / "fundamentals-b"))

    assert fetcher.get_annual_eps_growth("AAPL5Y", years=5) == 18.5
    assert fetcher.get_annual_eps_growth("AAPL5Y", years=3) is None
