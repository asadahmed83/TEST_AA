"""Canned sample results so the app can run without live network access.

Used when DEMO_MODE is on (see app.py) -- e.g. to preview the UI from an
environment that can't reach Yahoo Finance / Google News. Not real market
data; run the app with DEMO_MODE unset (and normal internet access) for
live scans.
"""

from data.news_fetcher import Headline
from data.price_fetcher import PriceSnapshot
from sentiment.analyzer import SentimentAnalyzer

_analyzer = SentimentAnalyzer()

_RAW = [
    # ticker, last_price, prev_close, volume, avg_volume, headlines[(title, source)]
    ("NVDA", 142.30, 131.80, 62_000_000, 38_000_000, [
        ("Nvidia beats earnings expectations, raises full-year guidance", "Yahoo Finance"),
        ("Analysts upgrade Nvidia after record AI chip demand", "Google News"),
        ("Nvidia stock surges on new data center partnership", "Google News"),
        ("Nvidia unveils breakthrough next-gen GPU architecture", "Yahoo Finance"),
    ]),
    ("PLTR", 28.90, 26.10, 41_000_000, 22_000_000, [
        ("Palantir shares rally after major government contract win", "Yahoo Finance"),
        ("Palantir upgraded to outperform on AI platform growth", "Google News"),
        ("Palantir announces new commercial partnership, stock jumps", "Google News"),
    ]),
    ("TSLA", 248.10, 246.90, 95_000_000, 90_000_000, [
        ("Tesla recalls vehicles over software issue", "Yahoo Finance"),
        ("Tesla deliveries miss analyst estimates", "Google News"),
        ("Tesla faces new lawsuit over autopilot claims", "Google News"),
    ]),
    ("AAPL", 231.40, 229.80, 48_000_000, 47_500_000, [
        ("Apple's quarterly results roughly in line with estimates", "Yahoo Finance"),
        ("Apple announces minor software update", "Google News"),
    ]),
    ("AMD", 172.55, 158.20, 55_000_000, 34_000_000, [
        ("AMD stock soars on strong AI chip revenue beat", "Yahoo Finance"),
        ("AMD partnership with major cloud provider announced", "Google News"),
        ("Analysts bullish on AMD after record quarter", "Google News"),
    ]),
    ("SNOW", 118.20, 121.50, 12_000_000, 11_000_000, [
        ("Snowflake shares slump after cautious guidance", "Yahoo Finance"),
        ("Snowflake downgraded amid slowing growth concerns", "Google News"),
    ]),
    ("COIN", 245.60, 231.00, 18_000_000, 12_500_000, [
        ("Coinbase surges as crypto rally lifts trading volume", "Yahoo Finance"),
        ("Coinbase stock rallies on record high bitcoin price", "Google News"),
        ("Analysts upgrade Coinbase citing bullish crypto momentum", "Google News"),
    ]),
    ("META", 512.30, 509.10, 15_000_000, 14_800_000, [
        ("Meta announces routine product update", "Yahoo Finance"),
        ("Meta stock little changed after earnings call", "Google News"),
    ]),
    ("INTC", 21.80, 23.40, 60_000_000, 41_000_000, [
        ("Intel plunges after disappointing layoffs announcement", "Yahoo Finance"),
        ("Intel downgraded on weak foundry outlook", "Google News"),
        ("Intel reports quarterly loss, shares tumble", "Google News"),
    ]),
    ("SHOP", 89.40, 82.10, 9_000_000, 6_200_000, [
        ("Shopify beats revenue estimates, merchants surge", "Yahoo Finance"),
        ("Shopify upgraded after strong holiday sales data", "Google News"),
        ("Shopify stock rallies on new AI commerce tools", "Google News"),
    ]),
]


def build_demo_results():
    """Builds ScreenResult objects from canned data using the real scoring logic."""
    # Imported here to avoid a circular import with screener.py at module load time.
    from screener import ScreenResult

    import config

    results = []
    for ticker, last_price, prev_close, volume, avg_volume, headline_rows in _RAW:
        price = PriceSnapshot(
            ticker=ticker,
            last_price=last_price,
            prev_close=prev_close,
            percent_change=((last_price - prev_close) / prev_close) * 100,
            volume=volume,
            avg_volume=avg_volume,
        )
        headlines = [Headline(title=t, source=s, link="", published="") for t, s in headline_rows]
        sentiment = _analyzer.score_headlines(ticker, headlines)

        is_mover = (
            price.percent_change >= config.PRICE_MOVE_THRESHOLD
            and sentiment.average_score >= config.SENTIMENT_THRESHOLD
            and sentiment.headline_count >= config.MIN_HEADLINES
        )

        results.append(
            ScreenResult(
                ticker=ticker,
                price=price,
                sentiment=sentiment,
                is_sentiment_driven_mover=is_mover,
            )
        )

    results.sort(key=lambda r: r.sentiment.average_score, reverse=True)
    return results
