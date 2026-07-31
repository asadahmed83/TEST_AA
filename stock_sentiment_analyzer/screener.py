"""Combines price movement and news sentiment to flag stocks moving up on good news."""

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

import config
from data.news_fetcher import Headline, get_headlines
from data.price_fetcher import PriceSnapshot, get_price_snapshot
from sentiment.analyzer import SentimentAnalyzer, SentimentResult


@dataclass
class ScreenResult:
    ticker: str
    price: PriceSnapshot | None
    sentiment: SentimentResult | None
    is_sentiment_driven_mover: bool
    error: str | None = None


class Screener:
    def __init__(self, demo_mode: bool = False) -> None:
        self._analyzer = SentimentAnalyzer()
        self._cache: dict[str, tuple[float, list[ScreenResult]]] = {}
        self._demo_mode = demo_mode

    def _evaluate_ticker(self, ticker: str) -> ScreenResult:
        try:
            price = get_price_snapshot(ticker)
            headlines = get_headlines(ticker)
            sentiment = self._analyzer.score_headlines(ticker, headlines)

            is_mover = (
                price is not None
                and price.percent_change >= config.PRICE_MOVE_THRESHOLD
                and sentiment.average_score >= config.SENTIMENT_THRESHOLD
                and sentiment.headline_count >= config.MIN_HEADLINES
            )

            return ScreenResult(
                ticker=ticker,
                price=price,
                sentiment=sentiment,
                is_sentiment_driven_mover=is_mover,
            )
        except Exception as exc:  # noqa: BLE001 - one bad ticker shouldn't kill the scan
            return ScreenResult(
                ticker=ticker,
                price=None,
                sentiment=None,
                is_sentiment_driven_mover=False,
                error=str(exc),
            )

    def scan(self, tickers: list[str] | None = None, use_cache: bool = True) -> list[ScreenResult]:
        if self._demo_mode:
            from demo_data import build_demo_results

            return build_demo_results()

        tickers = tickers or config.DEFAULT_WATCHLIST
        cache_key = ",".join(sorted(tickers))

        if use_cache and cache_key in self._cache:
            cached_at, results = self._cache[cache_key]
            if time.time() - cached_at < config.CACHE_TTL_SECONDS:
                return results

        results = []
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = {pool.submit(self._evaluate_ticker, t): t for t in tickers}
            for future in as_completed(futures):
                results.append(future.result())

        results.sort(
            key=lambda r: (r.sentiment.average_score if r.sentiment else -999),
            reverse=True,
        )

        self._cache[cache_key] = (time.time(), results)
        return results
