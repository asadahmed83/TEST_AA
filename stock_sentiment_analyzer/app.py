"""Flask dashboard for the stock sentiment screener."""

from flask import Flask, jsonify, render_template, request

import config
from screener import Screener

app = Flask(__name__)
screener = Screener()


@app.route("/")
def index():
    results = screener.scan()
    return render_template(
        "index.html",
        results=results,
        config=config,
        watchlist=", ".join(config.DEFAULT_WATCHLIST),
    )


@app.route("/api/scan")
def api_scan():
    tickers_param = request.args.get("tickers")
    tickers = [t.strip().upper() for t in tickers_param.split(",")] if tickers_param else None
    refresh = request.args.get("refresh") == "1"

    results = screener.scan(tickers=tickers, use_cache=not refresh)

    payload = [
        {
            "ticker": r.ticker,
            "error": r.error,
            "is_sentiment_driven_mover": r.is_sentiment_driven_mover,
            "price": {
                "last_price": r.price.last_price,
                "percent_change": r.price.percent_change,
                "volume_ratio": r.price.volume_ratio,
            }
            if r.price
            else None,
            "sentiment": {
                "average_score": r.sentiment.average_score,
                "headline_count": r.sentiment.headline_count,
                "positive_count": r.sentiment.positive_count,
                "negative_count": r.sentiment.negative_count,
                "top_headlines": [
                    {"title": h.title, "source": h.source, "link": h.link, "score": s}
                    for h, s in sorted(r.sentiment.scored_headlines, key=lambda x: x[1], reverse=True)[:5]
                ],
            }
            if r.sentiment
            else None,
        }
        for r in results
    ]
    return jsonify(payload)


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
