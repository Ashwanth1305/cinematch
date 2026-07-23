"""
CineMatch ML Engine — Preprocessing

Handles:
- Relevance label conversion (MovieLens & Indian Regional scales)
- Compact internal ID mapping  (global_*_id → internal index)
- Positive interaction extraction for LightFM
- Interaction weight calculation with source-specific weights
- Per-user train / validation / test splitting
- Mapping persistence
"""

import logging
from typing import Dict, Tuple

import numpy as np
import pandas as pd
import joblib

from . import config

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Relevance labels
# ---------------------------------------------------------------------------

def add_relevance_labels(ratings: pd.DataFrame) -> pd.DataFrame:
    """
    Add a ``relevance`` column (0–4) based on source-specific rules.

    Supports two strategies:
    1. If ``preference_label`` exists (like/neutral/dislike), use it directly.
    2. Otherwise, fall back to ``source_rating`` with source-specific mapping.

    Parameters
    ----------
    ratings : pd.DataFrame
        Must have ``source`` (or ``source_dataset``) column and
        either ``preference_label`` or ``source_rating``.

    Returns
    -------
    pd.DataFrame
        Same frame with an extra ``relevance`` column.
    """
    import numpy as np

    ratings = ratings.copy()

    # Ensure we have a "source" column
    if "source" not in ratings.columns and "source_dataset" in ratings.columns:
        ratings["source"] = ratings["source_dataset"]

    has_pref = "preference_label" in ratings.columns
    has_src_rating = "source_rating" in ratings.columns

    # Default: neutral
    relevance = np.ones(len(ratings), dtype=np.int32)

    if has_pref:
        # --- Vectorized strategy 1: use preference_label ---
        pref = ratings["preference_label"].astype(str).str.strip().str.lower()
        relevance[pref == "like"] = 4
        relevance[pref == "neutral"] = 1
        relevance[pref == "dislike"] = 0
        logger.info("Used preference_label for relevance mapping (vectorized)")

    elif has_src_rating:
        # --- Vectorized strategy 2: use source_rating ---
        src = ratings["source"].values
        raw = ratings["source_rating"].values.astype(float)
        is_indian = src == "indian_regional"

        # MovieLens mapping (vectorized)
        ml_mask = ~is_indian
        relevance[ml_mask & (raw >= 4.5)] = 4
        relevance[ml_mask & (raw >= 4.0) & (raw < 4.5)] = 3
        relevance[ml_mask & (raw >= 3.0) & (raw < 4.0)] = 1
        relevance[ml_mask & (raw < 3.0)] = 0

        # Indian mapping (vectorized)
        relevance[is_indian & (raw == 1)] = 4
        relevance[is_indian & (raw == 0)] = 1
        relevance[is_indian & (raw == -1)] = 0
        logger.info("Used source_rating for relevance mapping (vectorized)")

    ratings["relevance"] = relevance

    logger.info("Relevance distribution:\n%s",
                ratings["relevance"].value_counts().sort_index().to_string())
    return ratings


# ---------------------------------------------------------------------------
# ID mappings
# ---------------------------------------------------------------------------

def build_id_mappings(
    ratings: pd.DataFrame,
) -> Tuple[Dict, Dict, Dict, Dict]:
    """
    Create compact 0-based internal indices for users and movies.

    Returns
    -------
    (user_to_idx, idx_to_user, movie_to_idx, idx_to_movie)
    """
    unique_users = sorted(ratings["global_user_id"].unique())
    unique_movies = sorted(ratings["global_movie_id"].unique())

    user_to_idx = {uid: i for i, uid in enumerate(unique_users)}
    idx_to_user = {i: uid for uid, i in user_to_idx.items()}

    movie_to_idx = {mid: i for i, mid in enumerate(unique_movies)}
    idx_to_movie = {i: mid for mid, i in movie_to_idx.items()}

    logger.info("ID mappings: %d users → [0..%d], %d movies → [0..%d]",
                len(user_to_idx), len(user_to_idx) - 1,
                len(movie_to_idx), len(movie_to_idx) - 1)

    return user_to_idx, idx_to_user, movie_to_idx, idx_to_movie


def save_mappings(
    user_to_idx: Dict,
    idx_to_user: Dict,
    movie_to_idx: Dict,
    idx_to_movie: Dict,
) -> None:
    """Persist ID mappings to artifacts directory."""
    joblib.dump(
        {"to_idx": user_to_idx, "to_id": idx_to_user},
        config.ARTIFACT_FILES["user_mapping"],
    )
    joblib.dump(
        {"to_idx": movie_to_idx, "to_id": idx_to_movie},
        config.ARTIFACT_FILES["movie_mapping"],
    )
    logger.info("Saved ID mappings to %s", config.ARTIFACTS_DIR)


def load_mappings() -> Tuple[Dict, Dict, Dict, Dict]:
    """Load persisted ID mappings."""
    user_map = joblib.load(config.ARTIFACT_FILES["user_mapping"])
    movie_map = joblib.load(config.ARTIFACT_FILES["movie_mapping"])
    return (
        user_map["to_idx"],
        user_map["to_id"],
        movie_map["to_idx"],
        movie_map["to_id"],
    )


# ---------------------------------------------------------------------------
# Positive interactions for LightFM
# ---------------------------------------------------------------------------

def extract_positive_interactions(ratings: pd.DataFrame) -> pd.DataFrame:
    """
    Extract only positive user-movie interactions for LightFM training.

    Uses preference_label if available, otherwise falls back to source_rating:
    - MovieLens: source_rating >= 3.0
    - Indian Regional: source_rating == 1

    Neutral and disliked movies are NOT treated as positives.
    """
    # Ensure source column
    source_col = "source" if "source" in ratings.columns else "source_dataset"

    if "preference_label" in ratings.columns:
        # Use preference_label directly
        mask = ratings["preference_label"].str.lower().str.strip() == "like"
        positives = ratings[mask].copy()
    else:
        # Fallback to source_rating or rating
        rating_col = "source_rating" if "source_rating" in ratings.columns else "rating"

        mask_ml = (
            (ratings[source_col] != "indian_regional")
            & (ratings[rating_col].astype(float) >= config.MOVIELENS_POSITIVE_THRESHOLD)
        )
        mask_in = (
            (ratings[source_col] == "indian_regional")
            & (ratings[rating_col].astype(float) == config.INDIAN_POSITIVE_VALUE)
        )
        positives = ratings[mask_ml | mask_in].copy()

    logger.info(
        "Positive interactions: %d / %d total (%.1f%%)",
        len(positives), len(ratings),
        100 * len(positives) / max(len(ratings), 1),
    )
    return positives


def compute_interaction_weights(ratings: pd.DataFrame) -> np.ndarray:
    """
    Compute per-interaction weights based on source and rating.

    MovieLens weight = SOURCE_WEIGHTS["movielens"] * (normalized_rating)
    Indian weight    = SOURCE_WEIGHTS["indian_regional"] * 1.0
    """
    source_col = "source" if "source" in ratings.columns else "source_dataset"
    weights = np.ones(len(ratings), dtype=np.float32)

    # Vectorized approach for performance on large datasets
    is_indian = ratings[source_col].values == "indian_regional"

    # Get a rating value for weight scaling
    if "normalized_rating" in ratings.columns:
        norm_ratings = ratings["normalized_rating"].values.astype(np.float32)
    elif "source_rating" in ratings.columns:
        # Rough normalization
        norm_ratings = ratings["source_rating"].values.astype(np.float32)
        # For movielens: divide by 5; for indian: already 0/1
        ml_mask = ~is_indian
        if ml_mask.any():
            norm_ratings[ml_mask] = norm_ratings[ml_mask] / 5.0
    elif "rating" in ratings.columns:
        norm_ratings = ratings["rating"].values.astype(np.float32) / 5.0
    else:
        norm_ratings = np.full(len(ratings), 0.5, dtype=np.float32)

    ml_weight = config.SOURCE_WEIGHTS.get("movielens", 1.0)
    in_weight = config.SOURCE_WEIGHTS.get("indian_regional", 5.0)

    weights[~is_indian] = ml_weight * np.clip(norm_ratings[~is_indian], 0.1, 1.0)
    weights[is_indian] = in_weight

    return weights


# ---------------------------------------------------------------------------
# Per-user train / validation / test split
# ---------------------------------------------------------------------------

def per_user_split(
    ratings: pd.DataFrame,
    train_ratio: float = config.TRAIN_RATIO,
    val_ratio: float = config.VAL_RATIO,
    random_state: int = 42,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Split ratings per user so each user's interactions are divided
    into train / validation / test.  Ordering is preserved if a
    timestamp column exists; otherwise random.

    Uses vectorized operations for performance on large datasets.

    Returns
    -------
    (train_df, val_df, test_df)
    """
    # Sort by timestamp if available
    ts_col = None
    for candidate in ("timestamp", "created_at", "rated_at", "ts"):
        if candidate in ratings.columns:
            ts_col = candidate
            break

    if ts_col:
        ratings = ratings.sort_values(["global_user_id", ts_col])
    else:
        ratings = ratings.sample(frac=1, random_state=random_state)

    # Compute within-user position and count using vectorized groupby
    user_groups = ratings.groupby("global_user_id", sort=False)
    cumcount = user_groups.cumcount()
    user_sizes = user_groups["global_movie_id"].transform("count")

    # Compute split boundaries per row
    n_train = np.maximum(1, (user_sizes * train_ratio).astype(int))
    n_val = np.maximum(0, (user_sizes * val_ratio).astype(int))

    train_mask = cumcount < n_train
    val_mask = (cumcount >= n_train) & (cumcount < n_train + n_val)
    test_mask = cumcount >= (n_train + n_val)

    train_df = ratings[train_mask].reset_index(drop=True)
    val_df = ratings[val_mask].reset_index(drop=True)
    test_df = ratings[test_mask].reset_index(drop=True)

    logger.info(
        "Per-user split → train: %d, val: %d, test: %d",
        len(train_df), len(val_df), len(test_df),
    )

    return train_df, val_df, test_df

