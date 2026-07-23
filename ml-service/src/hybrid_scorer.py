"""
CineMatch ML Engine — Hybrid Scorer

Implements the fixed 60 / 40 blending formula and score normalisation.

    final_score = 0.60 × rule_score  +  0.40 × normalised_xgb_ranker_score

The raw LightFM score is **never** blended directly into this formula.
LightFM serves as an input feature to XGBRanker, whose normalised output
is what enters the 40 % slot.
"""

from typing import Optional, Sequence

import numpy as np

from . import config


# ---------------------------------------------------------------------------
# Score normalisation
# ---------------------------------------------------------------------------

def normalize_scores(scores: np.ndarray) -> np.ndarray:
    """
    Normalise XGBRanker raw outputs to [0, 1] within the candidate set.

    Parameters
    ----------
    scores : np.ndarray
        Raw XGBRanker predictions for a set of candidates.

    Returns
    -------
    np.ndarray
        Values in [0, 1].  If all values are identical, returns 0.5.
    """
    scores = np.asarray(scores, dtype=np.float32)
    minimum = scores.min()
    maximum = scores.max()
    if maximum == minimum:
        return np.full_like(scores, 0.5, dtype=np.float32)
    return (scores - minimum) / (maximum - minimum)


# ---------------------------------------------------------------------------
# Fixed hybrid formula
# ---------------------------------------------------------------------------

def calculate_final_score(
    rule_score: float,
    ranker_score: Optional[float],
) -> float:
    """
    Blend rule-based and ML-based scores with the production formula.

    Parameters
    ----------
    rule_score : float
        Score produced by the existing CineMatch rule-based engine.
    ranker_score : float | None
        Normalised XGBRanker score.  ``None`` when the ML service is
        unavailable, the movie is unmapped, or it is a cold-start case.

    Returns
    -------
    float
        Final blended score.  Falls back to 100 % rule_score when the
        ranker score is missing.
    """
    if ranker_score is None:
        return float(rule_score)
    return (
        config.RULE_WEIGHT * float(rule_score)
        + config.MODEL_WEIGHT * float(ranker_score)
    )


def calculate_final_scores_batch(
    rule_scores: np.ndarray,
    ranker_scores: Optional[np.ndarray],
) -> np.ndarray:
    """
    Vectorised version of :func:`calculate_final_score`.

    If *ranker_scores* is ``None`` (ML unavailable), returns rule_scores
    unchanged.  Otherwise applies the 60 / 40 blend element-wise.
    """
    rule_scores = np.asarray(rule_scores, dtype=np.float64)
    if ranker_scores is None:
        return rule_scores
    ranker_scores = np.asarray(ranker_scores, dtype=np.float64)
    return config.RULE_WEIGHT * rule_scores + config.MODEL_WEIGHT * ranker_scores
