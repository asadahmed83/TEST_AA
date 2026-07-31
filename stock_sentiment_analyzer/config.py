"""Configuration for the stock sentiment screener."""

# Default watchlist scanned when no custom list is supplied.
# Swap this for a full S&P 500 / Nasdaq list later; kept small for v1
# so a scan finishes quickly against free, rate-limited data sources.
DEFAULT_WATCHLIST = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "AMD",
    "NFLX", "AVGO", "CRM", "ORCL", "ADBE", "INTC", "QCOM", "UBER",
    "PLTR", "COIN", "SHOP", "SNOW", "JPM", "BAC", "V", "MA",
    "WMT", "COST", "DIS", "PFE", "XOM", "CVX",
]

# Minimum single-day price gain (%) for a stock to be considered a "mover".
PRICE_MOVE_THRESHOLD = 2.0

# Minimum VADER compound sentiment score (-1..1) for news to count as positive.
SENTIMENT_THRESHOLD = 0.2

# Minimum number of distinct headlines required before trusting the sentiment score.
MIN_HEADLINES = 2

# How long to cache a scan's results, in seconds.
CACHE_TTL_SECONDS = 15 * 60
