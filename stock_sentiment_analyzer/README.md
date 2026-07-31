# Stock Sentiment Screener (v1)

Scans a watchlist of stocks and flags ones that are moving up on positive news
sentiment: same-day price gain above a threshold, combined with recent
headlines scoring positive on average.

## How it works

1. **Price data** — `data/price_fetcher.py` pulls recent daily price/volume
   history via [yfinance](https://github.com/ranaroussi/yfinance) (free, no
   API key).
2. **News** — `data/news_fetcher.py` pulls recent headlines per ticker from
   free RSS feeds (Yahoo Finance headline RSS + Google News RSS). No API key
   required, but coverage/rate limits are looser than a paid news API.
3. **Sentiment** — `sentiment/analyzer.py` scores each headline with VADER
   (lightweight lexicon-based sentiment), with a few finance-specific terms
   added (e.g. "beat", "downgrade", "bullish") since VADER's default lexicon
   is general-purpose.
4. **Screening** — `screener.py` combines the two: a ticker is flagged as a
   "sentiment-driven mover" if its price is up beyond
   `PRICE_MOVE_THRESHOLD`, average sentiment is above `SENTIMENT_THRESHOLD`,
   and there are at least `MIN_HEADLINES` recent headlines. Thresholds live
   in `config.py`.

## Setup

```bash
cd stock_sentiment_analyzer
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
```

## Run

**Web dashboard:**

```bash
python app.py
# open http://localhost:5000
```

**CLI:**

```bash
python run_screener.py                  # scans the default watchlist
python run_screener.py AAPL TSLA NVDA    # scans specific tickers
```

## Known limitations (v1)

- Watchlist is a fixed, hardcoded list of ~30 large-cap tickers
  (`config.DEFAULT_WATCHLIST`), not the whole market — free data sources
  don't support a cheap full-market scan.
- News coverage depends on free RSS feeds, which are noisier and less
  complete than a paid news API and have no historical backfill.
- VADER is a general-purpose sentiment model, not finance-tuned; scores are
  a decent proxy but will misread some financial jargon and sarcasm.
- No persistence — results are cached in memory only (`CACHE_TTL_SECONDS`)
  and reset when the app restarts.
- No backtesting yet, so thresholds in `config.py` are starting guesses, not
  validated against historical accuracy.

## Ideas for next iterations

- Expand the watchlist to the full S&P 500 / Nasdaq (needs faster/batched
  data fetching).
- Swap VADER for a finance-tuned model (e.g. FinBERT) once accuracy matters
  more than setup simplicity.
- Add a paid news/sentiment API (Alpha Vantage News Sentiment, Benzinga,
  NewsAPI, Polygon.io) for better coverage and lower latency.
- Persist scan history to spot sentiment *trends*, not just a single
  snapshot.
- Backtest thresholds against historical price/news data to tune for
  precision vs. recall.
- Add alerts (email/Slack/webhook) when a new mover is flagged.
