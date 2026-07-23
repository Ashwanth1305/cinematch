"""
CineMatch ML Engine — Recommender (Inference Pipeline)

Inference flow:
  1. Receive candidates with rule-based scores
  2. Map movie IDs to internal indices
  3. Score with LightFM
  4. Build XGBRanker feature vector
  5. Predict with XGBRanker
  6. Normalize scores to [0, 1]
  7. Blend: 0.60 × rule_score + 0.40 × xgb_ranker_score
  8. Sort descending and return
"""

import logging
from typing import Dict, List, Optional, Tuple, Union

import numpy as np
import pandas as pd

from . import config
from .model_store import ModelBundle, get_bundle, has_lightfm, has_xgb_ranker
from .hybrid_scorer import normalize_scores, calculate_final_score
from .lightfm_trainer import score_candidates, _get_dataset_mappings

logger = logging.getLogger(__name__)


def recommend(
    user_id: Union[int, str],
    candidates: List[Dict],
    top_k: int = 20,
    bundle: Optional[ModelBundle] = None,
) -> List[Dict]:
    """
    Full inference pipeline for a single user.

    Parameters
    ----------
    user_id : int
        CineMatch user ID (or global_user_id from training data).
    candidates : list of dict
        Each candidate must include at minimum:
          - movie_id
          - rule_score
        Optional enrichment fields:
          - genre_affinity_score, language_match_score,
            actor_match_score, director_match_score,
            keyword_similarity_score, tmdb_rating,
            tmdb_popularity, release_year
    top_k : int
        Number of results to return.
    bundle : ModelBundle, optional
        Pre-loaded models. If None, loads from disk.

    Returns
    -------
    list of dict
        Sorted recommendations with scores.
    """
    if bundle is None:
        bundle = get_bundle()

    if not candidates:
        return []

    movie_ids = [c["movie_id"] for c in candidates]
    rule_scores = np.array([c.get("rule_score", 0.5) for c in candidates], dtype=np.float32)

    # --- Stage 1: LightFM scoring -------------------------------------------
    lightfm_scores = _get_lightfm_scores(user_id, movie_ids, bundle)

    # --- Stage 2: XGBRanker scoring -----------------------------------------
    xgb_scores = _get_xgb_scores(
        user_id, candidates, lightfm_scores, bundle
    )

    # --- Blend: 60% rule + 40% XGBRanker ------------------------------------
    if xgb_scores is not None:
        normalized_xgb = normalize_scores(xgb_scores)
    else:
        normalized_xgb = None

    final_scores = np.array([
        calculate_final_score(
            rule_scores[i],
            float(normalized_xgb[i]) if normalized_xgb is not None else None,
        )
        for i in range(len(candidates))
    ])

    # --- Sort and return ----------------------------------------------------
    ranked_indices = np.argsort(-final_scores)[:top_k]

    results = []
    for idx in ranked_indices:
        result = {
            "movie_id": movie_ids[idx],
            "lightfm_score": float(lightfm_scores[idx]) if lightfm_scores is not None else None,
            "ranker_score": float(normalized_xgb[idx]) if normalized_xgb is not None else None,
            "rule_score": float(rule_scores[idx]),
            "final_score": float(final_scores[idx]),
        }
        results.append(result)

    return results


def compute_hybrid_score(
    rule_score: float,
    movie_id: int,
    user_id: Union[int, str],
    candidate_features: Optional[Dict] = None,
    bundle: Optional[ModelBundle] = None,
) -> Dict:
    """
    Compute the hybrid score for a single user–movie pair.

    Returns a dict with all component scores.
    """
    if bundle is None:
        bundle = get_bundle()

    # LightFM
    lightfm_scores = _get_lightfm_scores(user_id, [movie_id], bundle)
    lf_score = float(lightfm_scores[0]) if lightfm_scores is not None else None

    # Build a single candidate
    candidate = {
        "movie_id": movie_id,
        "rule_score": rule_score,
        **(candidate_features or {}),
    }

    # XGBRanker
    xgb_scores = _get_xgb_scores(user_id, [candidate], lightfm_scores, bundle)
    xgb_score = float(xgb_scores[0]) if xgb_scores is not None else None

    # For a single item, normalized score is 0.5 (max == min)
    normalized_xgb = 0.5 if xgb_score is not None else None

    final = calculate_final_score(rule_score, normalized_xgb)

    return {
        "movie_id": movie_id,
        "user_id": user_id,
        "lightfm_score": lf_score,
        "raw_xgb_score": xgb_score,
        "normalized_xgb_score": normalized_xgb,
        "rule_score": rule_score,
        "final_score": final,
    }


# ---------------------------------------------------------------------------
# Internal: LightFM scoring
# ---------------------------------------------------------------------------

def _get_lightfm_scores(
    user_id: Union[int, str],
    movie_ids: List[int],
    bundle: ModelBundle,
) -> Optional[np.ndarray]:
    """Score candidates with LightFM. Returns None if unavailable."""
    if not has_lightfm():
        return None

    # Live application users use UUIDs and are not present in the offline
    # LightFM interaction matrix. XGBRanker still provides a valid cold-start
    # ranking from the supplied content and taste features.
    if not isinstance(user_id, (int, np.integer)):
        return None

    try:
        scores = score_candidates(
            model=bundle.lightfm_model,
            dataset=bundle.lightfm_dataset,
            user_id=user_id,
            candidate_movie_ids=movie_ids,
            user_features=bundle.user_features,
            item_features=bundle.item_features,
        )
        return scores
    except Exception as e:
        logger.warning("LightFM scoring failed for user %s: %s", user_id, e)
        return None


# ---------------------------------------------------------------------------
# Internal: XGBRanker scoring
# ---------------------------------------------------------------------------

def _get_xgb_scores(
    user_id: int,
    candidates: List[Dict],
    lightfm_scores: Optional[np.ndarray],
    bundle: ModelBundle,
) -> Optional[np.ndarray]:
    """Score candidates with XGBRanker. Returns None if unavailable."""
    if not has_xgb_ranker():
        return None

    try:
        feature_columns = bundle.xgb_feature_columns
        n_features = len(feature_columns)
        n_candidates = len(candidates)

        X = np.zeros((n_candidates, n_features), dtype=np.float32)

        for i, candidate in enumerate(candidates):
            for j, col in enumerate(feature_columns):
                if col == "lightfm_score":
                    X[i, j] = float(lightfm_scores[i]) if lightfm_scores is not None else 0.0
                elif col == "lightfm_score_missing":
                    X[i, j] = 0.0 if lightfm_scores is not None else 1.0
                elif col == "rule_based_score":
                    X[i, j] = candidate.get("rule_score", 0.5)
                elif col == "genre_affinity_score":
                    X[i, j] = candidate.get("genre_affinity_score", 0.5)
                elif col == "language_match_score":
                    X[i, j] = candidate.get("language_match_score", 0.5)
                elif col == "actor_match_score":
                    X[i, j] = candidate.get("actor_match_score", 0.0)
                elif col == "director_match_score":
                    X[i, j] = candidate.get("director_match_score", 0.0)
                elif col == "keyword_similarity_score":
                    X[i, j] = candidate.get("keyword_similarity_score", 0.0)
                elif col == "normalized_movie_rating":
                    rating = candidate.get("tmdb_rating", 5.0)
                    X[i, j] = min(rating / 10.0, 1.0)
                elif col == "normalized_movie_popularity":
                    pop = candidate.get("tmdb_popularity", 50.0)
                    X[i, j] = min(pop / 200.0, 1.0)  # rough normalization
                elif col == "release_recency_score":
                    year = candidate.get("release_year", 2020)
                    age = 2025 - year
                    X[i, j] = 1.0 / (1.0 + np.exp(0.15 * (age - 5)))
                elif col == "source_dataset":
                    X[i, j] = candidate.get("source_dataset", 0)
                elif col == "is_indian_content":
                    X[i, j] = candidate.get("is_indian_content", 0)
                elif col == "is_cold_start_movie":
                    X[i, j] = candidate.get("is_cold_start_movie", 0)
                else:
                    X[i, j] = candidate.get(col, 0.0)

        scores = bundle.xgb_ranker.predict(X)
        return scores.astype(np.float32)
    except Exception as e:
        logger.warning("XGBRanker scoring failed: %s", e)
        return None
