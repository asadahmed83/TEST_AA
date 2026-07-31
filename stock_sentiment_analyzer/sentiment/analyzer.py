"""Scores headline sentiment with VADER, tuned with a few finance-specific terms.

VADER is a lightweight lexicon/rule-based analyzer -- no model download or GPU
needed, which keeps v1 easy to run. Swap in a finance-tuned transformer model
(e.g. FinBERT) later if VADER's general-purpose lexicon proves too noisy.
"""

from dataclasses import dataclass

from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

from data.news_fetcher import Headline

# Finance-specific terms VADER's general lexicon doesn't score well.
# Values follow VADER's -4..4 intensity convention.
FINANCE_LEXICON_OVERRIDES = {
    "beat": 2.5,
    "beats": 2.5,
    "miss": -2.5,
    "misses": -2.5,
    "upgrade": 2.5,
    "upgraded": 2.5,
    "downgrade": -2.5,
    "downgraded": -2.5,
    "bullish": 2.5,
    "bearish": -2.5,
    "surge": 2.5,
    "surges": 2.5,
    "soar": 2.7,
    "soars": 2.7,
    "plunge": -2.7,
    "plunges": -2.7,
    "slump": -2.3,
    "rally": 2.3,
    "rallies": 2.3,
    "outperform": 2.3,
    "underperform": -2.3,
    "record high": 2.8,
    "record low": -2.5,
    "layoffs": -2.5,
    "lawsuit": -2.0,
    "recall": -2.0,
    "breakthrough": 2.5,
    "partnership": 1.5,
    "buyback": 1.8,
    "bankruptcy": -3.5,
    "fraud": -3.5,
    "profit": 1.8,
    "loss": -1.8,
}


@dataclass
class SentimentResult:
    ticker: str
    average_score: float  # VADER compound score, -1..1
    headline_count: int
    positive_count: int
    negative_count: int
    scored_headlines: list[tuple[Headline, float]]


class SentimentAnalyzer:
    def __init__(self) -> None:
        self._vader = SentimentIntensityAnalyzer()
        self._vader.lexicon.update(FINANCE_LEXICON_OVERRIDES)

    def score_text(self, text: str) -> float:
        return self._vader.polarity_scores(text)["compound"]

    def score_headlines(self, ticker: str, headlines: list[Headline]) -> SentimentResult:
        scored = [(h, self.score_text(h.title)) for h in headlines]
        scores = [s for _, s in scored]

        average = sum(scores) / len(scores) if scores else 0.0
        positive = sum(1 for s in scores if s > 0.05)
        negative = sum(1 for s in scores if s < -0.05)

        return SentimentResult(
            ticker=ticker,
            average_score=average,
            headline_count=len(headlines),
            positive_count=positive,
            negative_count=negative,
            scored_headlines=scored,
        )
