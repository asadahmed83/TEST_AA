"""Fetches recent headlines for a ticker from free RSS feeds (no API key required).

Swap or add sources (e.g. NewsAPI, Alpha Vantage News Sentiment, Benzinga) here
once a paid data plan is worth the cost.
"""

from dataclasses import dataclass
from urllib.parse import quote_plus

import feedparser

YAHOO_RSS_URL = "https://feeds.finance.yahoo.com/rss/2.0/headline?s={ticker}&region=US&lang=en-US"
GOOGLE_NEWS_RSS_URL = "https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en"

MAX_HEADLINES_PER_SOURCE = 10


@dataclass
class Headline:
    title: str
    source: str
    link: str
    published: str


def _parse_feed(url: str, source: str, limit: int) -> list[Headline]:
    feed = feedparser.parse(url)
    headlines = []
    for entry in feed.entries[:limit]:
        headlines.append(
            Headline(
                title=entry.get("title", "").strip(),
                source=source,
                link=entry.get("link", ""),
                published=entry.get("published", ""),
            )
        )
    return headlines


def get_headlines(ticker: str, company_name: str | None = None) -> list[Headline]:
    """Pulls recent headlines for a ticker from Yahoo Finance and Google News RSS."""
    headlines = _parse_feed(
        YAHOO_RSS_URL.format(ticker=quote_plus(ticker)),
        source="Yahoo Finance",
        limit=MAX_HEADLINES_PER_SOURCE,
    )

    query = f"{company_name or ticker} stock"
    headlines += _parse_feed(
        GOOGLE_NEWS_RSS_URL.format(query=quote_plus(query)),
        source="Google News",
        limit=MAX_HEADLINES_PER_SOURCE,
    )

    # De-dupe by title in case both feeds surface the same story.
    seen = set()
    unique_headlines = []
    for headline in headlines:
        key = headline.title.lower()
        if key and key not in seen:
            seen.add(key)
            unique_headlines.append(headline)

    return unique_headlines
