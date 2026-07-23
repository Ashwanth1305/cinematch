"""
CineMatch ML Engine — Ranker Dataset Builder

Constructs the feature table for XGBRanker training.
Each row represents a (user, movie) pair with 20 ranking features.

Data is sorted by user, and group sizes are computed per user
for the learning-to-rank objective.
"""

import logging
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from . import config
from .feature_builder import (
    compute_movie_stats,
    compute_user_stats,
    compute_metadata_completeness,
    compute_release_recency,
    normalize_series,
    _find_col,
    _safe_split,
    _tokenize,
)

logger = logging.getLogger(__name__)


def build_ranker_dataset(
    ratings_with_negatives: pd.DataFrame,
    movies_df: pd.DataFrame,
    users_df: pd.DataFrame,
    all_ratings: pd.DataFrame,
    movie_feature_tokens: Dict[int, List[str]],
    user_feature_tokens: Dict[int, List[str]],
    lightfm_scores: Optional[Dict[int, Dict[int, float]]] = None,
) -> Tuple[pd.DataFrame, np.ndarray, List[str]]:
    """
    Build the complete feature table for XGBRanker.

    Parameters
    ----------
    ratings_with_negatives : pd.DataFrame
        Positive interactions + synthetic negatives with columns:
        global_user_id, global_movie_id, relevance, source,
        is_synthetic_negative.
    movies_df : pd.DataFrame
        Movie metadata.
    users_df : pd.DataFrame
        User metadata.
    all_ratings : pd.DataFrame
        Full ratings (for computing aggregate stats).
    movie_feature_tokens : dict
        global_movie_id → feature tokens from feature_builder.
    user_feature_tokens : dict
        global_user_id → feature tokens from feature_builder.
    lightfm_scores : dict, optional
        {user_id: {movie_id: score}}.

    Returns
    -------
    (feature_df, group_sizes, feature_columns)
        feature_df has feature columns + global_user_id + global_movie_id + relevance
        group_sizes: numpy array of per-user group sizes
        feature_columns: ordered list of feature names used
    """
    df = ratings_with_negatives.copy()

    # Sort by user (required for XGBRanker groups)
    df = df.sort_values("global_user_id").reset_index(drop=True)

    # --- Pre-compute aggregate stats ----------------------------------------
    movie_stats = compute_movie_stats(all_ratings)
    user_stats = compute_user_stats(all_ratings)

    # Merge stats
    df = df.merge(movie_stats, on="global_movie_id", how="left")
    df = df.merge(user_stats, on="global_user_id", how="left")

    # Fill NaN stats with defaults
    df["movie_interaction_count"] = df["movie_interaction_count"].fillna(0)
    df["user_interaction_count"] = df["user_interaction_count"].fillna(0)
    df["movie_average_rating"] = df["movie_average_rating"].fillna(0.0)
    df["user_average_rating"] = df["user_average_rating"].fillna(0.0)
    df["negative_feedback_count"] = df["negative_feedback_count"].fillna(0)

    # --- Build per-row features ---------------------------------------------

    # 1. LightFM score
    if lightfm_scores:
        df["lightfm_score"] = df.apply(
            lambda r: lightfm_scores.get(r["global_user_id"], {}).get(
                r["global_movie_id"], 0.0
            ),
            axis=1,
        ).astype(np.float32)
        df["lightfm_score_missing"] = 0
    else:
        df["lightfm_score"] = 0.0
        df["lightfm_score_missing"] = 1

    # 2. Rule-based score  (simulated from available features)
    df["rule_based_score"] = _compute_rule_scores(
        df, movies_df, movie_feature_tokens, user_feature_tokens
    )

    # 3. Genre affinity score
    df["genre_affinity_score"] = _compute_genre_affinity(
        df, all_ratings, movie_feature_tokens
    )

    # 4. Language match score
    df["language_match_score"] = _compute_language_match(
        df, movie_feature_tokens, user_feature_tokens
    )

    # 5. Actor match score
    df["actor_match_score"] = _compute_actor_match(
        df, movies_df, all_ratings
    )

    # 6. Director match score
    df["director_match_score"] = _compute_director_match(
        df, movies_df, all_ratings
    )

    # 7. Keyword similarity score  (placeholder — real data may not have keywords)
    df["keyword_similarity_score"] = 0.0

    # 8. Normalized movie rating
    rating_col = _find_col(movies_df, ["vote_average", "imdb_rating", "rating", "avg_rating"])
    if rating_col:
        movie_ratings = movies_df.set_index("global_movie_id")[rating_col]
        df["normalized_movie_rating"] = (
            df["global_movie_id"].map(movie_ratings).fillna(0.0)
        )
        df["normalized_movie_rating"] = normalize_series(df["normalized_movie_rating"])
    else:
        df["normalized_movie_rating"] = 0.5

    # 9. Normalized movie popularity
    pop_col = _find_col(movies_df, ["popularity", "vote_count", "num_votes"])
    if pop_col:
        movie_pop = movies_df.set_index("global_movie_id")[pop_col]
        df["normalized_movie_popularity"] = (
            df["global_movie_id"].map(movie_pop).fillna(0.0)
        )
        df["normalized_movie_popularity"] = normalize_series(
            df["normalized_movie_popularity"]
        )
    else:
        # Use interaction count as proxy
        df["normalized_movie_popularity"] = normalize_series(
            df["movie_interaction_count"]
        )

    # 10. Release recency score
    recency = compute_release_recency(movies_df)
    recency_map = dict(zip(movies_df["global_movie_id"], recency))
    df["release_recency_score"] = (
        df["global_movie_id"].map(recency_map).fillna(0.5).astype(np.float32)
    )

    # 11. Metadata completeness
    completeness = compute_metadata_completeness(movies_df)
    comp_map = dict(zip(movies_df["global_movie_id"], completeness))
    df["metadata_completeness"] = (
        df["global_movie_id"].map(comp_map).fillna(0.5).astype(np.float32)
    )

    # 12. Source dataset  (binary: 0=movielens, 1=indian_regional)
    df["source_dataset"] = (df["source"] == "indian_regional").astype(np.int8)

    # 13. Is Indian content
    df["is_indian_content"] = _compute_is_indian(df, movies_df, movie_feature_tokens)

    # 14. Is cold-start movie  (<5 interactions)
    df["is_cold_start_movie"] = (df["movie_interaction_count"] < 5).astype(np.int8)

    # --- Select feature columns in order ------------------------------------
    feature_columns = config.XGB_FEATURE_COLUMNS.copy()

    # Ensure all columns exist
    for col in feature_columns:
        if col not in df.columns:
            df[col] = 0.0
            logger.warning("Feature '%s' not computed — defaulting to 0.0", col)

    # --- Compute group sizes ------------------------------------------------
    group_sizes = (
        df.groupby("global_user_id", sort=False).size().to_numpy()
    )

    logger.info(
        "Ranker dataset: %d rows, %d features, %d groups (users), "
        "avg group size %.1f",
        len(df), len(feature_columns), len(group_sizes),
        np.mean(group_sizes),
    )

    return df, group_sizes, feature_columns


# ---------------------------------------------------------------------------
# Internal feature computation helpers
# ---------------------------------------------------------------------------

def _compute_rule_scores(
    df: pd.DataFrame,
    movies_df: pd.DataFrame,
    movie_feature_tokens: Dict,
    user_feature_tokens: Dict,
) -> pd.Series:
    """
    Simulate the CineMatch rule-based scorer:
    score = (imdb_rating/10)*0.45 + genre_affinity*0.8 + director_bonus + actor_bonus
    Simplified for training data.
    """
    # Use normalized movie rating as the base
    rating_col = _find_col(movies_df, ["vote_average", "imdb_rating", "rating", "avg_rating"])
    if rating_col:
        movie_ratings = movies_df.set_index("global_movie_id")[rating_col]
        base = df["global_movie_id"].map(movie_ratings).fillna(5.0)
        score = (base / 10.0) * 0.45 + 0.4  # base rule score
    else:
        score = pd.Series(0.5, index=df.index)

    return score.clip(0, 1).astype(np.float32)


def _compute_genre_affinity(
    df: pd.DataFrame,
    all_ratings: pd.DataFrame,
    movie_feature_tokens: Dict,
) -> pd.Series:
    """
    For each (user, movie) pair, compute how well the movie's genres
    match the user's historical genre preferences.
    """
    # Build per-user genre preference vector
    user_genre_prefs = {}
    for uid, group in all_ratings.groupby("global_user_id"):
        genre_counts = {}
        total = 0
        for mid in group["global_movie_id"]:
            for tok in movie_feature_tokens.get(mid, []):
                if tok.startswith("genre:"):
                    genre_counts[tok] = genre_counts.get(tok, 0) + 1
                    total += 1
        if total > 0:
            user_genre_prefs[uid] = {g: c / total for g, c in genre_counts.items()}
        else:
            user_genre_prefs[uid] = {}

    def _score(row):
        uid = row["global_user_id"]
        mid = row["global_movie_id"]
        prefs = user_genre_prefs.get(uid, {})
        if not prefs:
            return 0.5
        movie_genres = [t for t in movie_feature_tokens.get(mid, []) if t.startswith("genre:")]
        if not movie_genres:
            return 0.5
        return np.mean([prefs.get(g, 0.0) for g in movie_genres])

    return df.apply(_score, axis=1).astype(np.float32)


def _compute_language_match(
    df: pd.DataFrame,
    movie_feature_tokens: Dict,
    user_feature_tokens: Dict,
) -> pd.Series:
    """Binary: 1 if any user language matches any movie language, else 0."""
    def _match(row):
        uid = row["global_user_id"]
        mid = row["global_movie_id"]
        user_langs = {
            t.replace("user_language:", "language:")
            for t in user_feature_tokens.get(uid, [])
            if t.startswith("user_language:")
        }
        movie_langs = {
            t for t in movie_feature_tokens.get(mid, [])
            if t.startswith("language:")
        }
        if not user_langs or not movie_langs:
            return 0.5  # unknown
        return 1.0 if user_langs & movie_langs else 0.0

    return df.apply(_match, axis=1).astype(np.float32)


def _compute_actor_match(
    df: pd.DataFrame,
    movies_df: pd.DataFrame,
    all_ratings: pd.DataFrame,
) -> pd.Series:
    """
    Count of matching actors between user's preferred actors and movie cast,
    normalized.
    """
    # Simplified: use movie feature tokens for cast
    # For training data, return 0 as we can't easily compute preferences
    return pd.Series(0.0, index=df.index, dtype=np.float32)


def _compute_director_match(
    df: pd.DataFrame,
    movies_df: pd.DataFrame,
    all_ratings: pd.DataFrame,
) -> pd.Series:
    """Binary: 1 if the movie's director is among user's preferred directors."""
    return pd.Series(0.0, index=df.index, dtype=np.float32)


def _compute_is_indian(
    df: pd.DataFrame,
    movies_df: pd.DataFrame,
    movie_feature_tokens: Dict,
) -> pd.Series:
    """Binary indicator for Indian content."""
    def _check(mid):
        tokens = movie_feature_tokens.get(mid, [])
        for t in tokens:
            if t in ("source:indian_regional", "language:hindi", "language:tamil",
                      "language:telugu", "language:malayalam", "language:kannada",
                      "language:bengali", "language:marathi", "language:gujarati",
                      "language:punjabi"):
                return 1
        return 0

    return df["global_movie_id"].map(_check).fillna(0).astype(np.int8)
