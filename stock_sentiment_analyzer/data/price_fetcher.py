"""Fetches recent price/volume data for a ticker via yfinance."""

from dataclasses import dataclass

import yfinance as yf


@dataclass
class PriceSnapshot:
    ticker: str
    last_price: float
    prev_close: float
    percent_change: float
    volume: int
    avg_volume: int

    @property
    def volume_ratio(self) -> float:
        if not self.avg_volume:
            return 0.0
        return self.volume / self.avg_volume


def get_price_snapshot(ticker: str) -> PriceSnapshot | None:
    """Returns today's price move and volume for a ticker, or None if unavailable."""
    stock = yf.Ticker(ticker)
    hist = stock.history(period="5d", interval="1d")
    if hist.empty or len(hist) < 2:
        return None

    last_price = float(hist["Close"].iloc[-1])
    prev_close = float(hist["Close"].iloc[-2])
    volume = int(hist["Volume"].iloc[-1])
    avg_volume = int(hist["Volume"].iloc[:-1].mean())
    percent_change = ((last_price - prev_close) / prev_close) * 100

    return PriceSnapshot(
        ticker=ticker,
        last_price=last_price,
        prev_close=prev_close,
        percent_change=percent_change,
        volume=volume,
        avg_volume=avg_volume,
    )
