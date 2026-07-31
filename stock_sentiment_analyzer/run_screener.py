"""CLI entrypoint: run a scan and print flagged movers to the terminal.

Usage:
    python run_screener.py [TICKER ...]
"""

import sys

from screener import Screener


def main() -> None:
    tickers = [t.upper() for t in sys.argv[1:]] or None
    screener = Screener()
    results = screener.scan(tickers=tickers)

    movers = [r for r in results if r.is_sentiment_driven_mover]

    print(f"Scanned {len(results)} tickers, {len(movers)} flagged as sentiment-driven movers.\n")

    for r in results:
        if r.error:
            print(f"{r.ticker}: error - {r.error}")
            continue

        flag = " <-- MOVER" if r.is_sentiment_driven_mover else ""
        print(
            f"{r.ticker:6s} "
            f"price={r.price.last_price:8.2f} "
            f"chg={r.price.percent_change:+6.2f}% "
            f"vol_ratio={r.price.volume_ratio:5.2f}x "
            f"sentiment={r.sentiment.average_score:+.2f} "
            f"headlines={r.sentiment.headline_count}"
            f"{flag}"
        )

        if r.is_sentiment_driven_mover:
            top = sorted(r.sentiment.scored_headlines, key=lambda x: x[1], reverse=True)[:3]
            for headline, score in top:
                print(f"    [{score:+.2f}] {headline.title} ({headline.source})")


if __name__ == "__main__":
    main()
