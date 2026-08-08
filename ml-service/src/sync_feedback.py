"""
CineMatch ML Engine — Live Feedback Sync & Normalization

Extracts live user ratings and aspect preferences from PostgreSQL (or local fallback),
normalizes 1–10 ratings to 0.5–5.0 scale + preference_label ('like'/'neutral'/'dislike'),
and updates the ML training dataset.
"""

import json
import logging
import os
from pathlib import Path
import pandas as pd
import numpy as np

from . import config

logger = logging.getLogger(__name__)

# Default PostgreSQL connection URL
POSTGRES_URL = os.getenv("DATABASE_URL", "postgresql://postgres:2005@localhost:5432/cinematch")


def fetch_postgres_feedback() -> pd.DataFrame:
    """Fetch user feedback directly from PostgreSQL database."""
    try:
        from sqlalchemy import create_engine
        engine = create_engine(POSTGRES_URL)
        query = """
            SELECT 
                f.id AS feedback_id,
                f.user_id AS global_user_id,
                f.movie_id AS global_movie_id,
                f.rating AS raw_rating,
                f.watched,
                f.liked_aspects,
                f.created_at AS timestamp,
                u.languages,
                u.occupation,
                u.state,
                u.date_of_birth,
                u.gender,
                m.title,
                m.tmdb_id
            FROM user_feedback f
            LEFT JOIN users u ON f.user_id = u.id
            LEFT JOIN movies m ON f.movie_id = m.id
            WHERE f.watched = 1 AND f.rating IS NOT NULL;
        """
        df = pd.read_sql(query, engine)
        logger.info("Fetched %d feedback rows from PostgreSQL database", len(df))
        return df
    except Exception as e:
        logger.warning("Could not fetch feedback from PostgreSQL: %s", e)
        return pd.DataFrame()


def normalize_feedback_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """
    Normalize 1-10 website ratings to 0.5-5.0 scale & preference_label:
      - raw_rating >= 7.0  -> preference_label='like',    relevance=4, normalized_rating=1.0
      - 4.0 <= raw_rating < 7.0 -> preference_label='neutral', relevance=1, normalized_rating=0.5
      - raw_rating < 4.0   -> preference_label='dislike', relevance=0, normalized_rating=0.0
    """
    if df.empty:
        return df

    ratings = df.copy()

    # Convert 1-10 to 0.5-5.0 scale
    ratings["source_rating"] = ratings["raw_rating"].astype(float) / 2.0
    ratings["normalized_rating"] = np.clip(ratings["source_rating"] / 5.0, 0.0, 1.0)
    ratings["source_dataset"] = "cinematch_live"
    ratings["source_user_id"] = ratings["global_user_id"]
    ratings["source_movie_id"] = ratings["global_movie_id"]

    # Assign preference labels
    raw = ratings["raw_rating"].values.astype(float)
    pref_labels = np.full(len(ratings), "neutral", dtype=object)
    pref_labels[raw >= 7.0] = "like"
    pref_labels[raw < 4.0] = "dislike"
    ratings["preference_label"] = pref_labels

    # Relevance column
    relevance = np.ones(len(ratings), dtype=np.int32)
    relevance[raw >= 7.0] = 4
    relevance[raw < 4.0] = 0
    ratings["relevance"] = relevance

    logger.info("Normalized %d live feedback ratings (likes: %d, neutrals: %d, dislikes: %d)",
                len(ratings),
                (ratings["preference_label"] == "like").sum(),
                (ratings["preference_label"] == "neutral").sum(),
                (ratings["preference_label"] == "dislike").sum())

    return ratings


def sync_and_export_feedback() -> Path:
    """
    Fetch feedback from PostgreSQL, normalize, and export to CSV
    so train.py includes it during model retraining.
    """
    df = fetch_postgres_feedback()
    if df.empty:
        logger.info("No live feedback to sync.")
        return None

    normalized_df = normalize_feedback_dataframe(df)

    export_path = config.DATA_DIR / "live_user_feedback.csv"
    canonical_cols = [
        "global_user_id", "global_movie_id", "normalized_rating", "source_rating",
        "source_dataset", "source_user_id", "source_movie_id", "timestamp", "preference_label"
    ]
    
    # Filter only columns present
    export_cols = [c for c in canonical_cols if c in normalized_df.columns]
    normalized_df[export_cols].to_csv(export_path, index=False)
    logger.info("Exported live feedback to %s", export_path)

    return export_path


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    sync_and_export_feedback()
