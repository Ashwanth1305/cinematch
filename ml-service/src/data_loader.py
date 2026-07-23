"""
CineMatch ML Engine — Data Loader

Load and combine the six rating chunks (plain CSV), the movie metadata,
and the user metadata.  Validates that both 'movielens' and
'indian_regional' sources are present in the combined ratings.

Column adaptations:
  - Ratings use `source_dataset` (not `source`), `normalized_rating`
    and `source_rating` (not plain `rating`).
  - Movies have `source_dataset` + `source_movie_id` but NO `global_movie_id`.
    The global mapping is created by joining with ratings.
  - Users have `source_dataset` + `source_user_id` but NO `global_user_id`.
    The global mapping is created by joining with ratings.
"""

import logging
from pathlib import Path
from typing import Tuple

import pandas as pd

from . import config

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def load_ratings() -> pd.DataFrame:
    """
    Load all six rating chunks in sorted order and concatenate them
    into a single DataFrame.

    Returns
    -------
    pd.DataFrame
        Combined ratings with columns:
        global_user_id, global_movie_id, normalized_rating, source_rating,
        source_dataset, source_user_id, source_movie_id, timestamp,
        preference_label
    """
    chunk_paths = sorted(
        config.DATA_DIR / name for name in config.RATING_CHUNKS
    )

    missing = [p for p in chunk_paths if not p.exists()]
    if missing:
        raise FileNotFoundError(
            f"Missing rating chunk(s): {[str(m) for m in missing]}"
        )

    frames = []
    for path in chunk_paths:
        logger.info("Loading %s …", path.name)
        df = pd.read_csv(path)
        logger.info("  → %d rows, columns: %s", len(df), list(df.columns))
        frames.append(df)

    ratings = pd.concat(frames, ignore_index=True)
    logger.info("Combined ratings: %d rows total", len(ratings))

    # --- Normalise column names ---------------------------------------------
    # Map to canonical names used throughout the codebase
    _ensure_column(ratings, "source_dataset",
                   ["source", "data_source", "dataset"])
    # Alias: many modules use "source" short name
    if "source" not in ratings.columns and "source_dataset" in ratings.columns:
        ratings["source"] = ratings["source_dataset"]

    _ensure_column(ratings, "global_user_id",
                   ["user_id", "userId", "user"])
    _ensure_column(ratings, "global_movie_id",
                   ["movie_id", "movieId", "item_id", "itemId"])

    # Create a canonical "rating" column from source_rating if available
    # (many modules reference just "rating")
    if "rating" not in ratings.columns:
        if "source_rating" in ratings.columns:
            ratings["rating"] = ratings["source_rating"]
        elif "normalized_rating" in ratings.columns:
            # Scale 0-1 back to 0-5 for MovieLens compatibility
            ratings["rating"] = ratings["normalized_rating"] * 5.0

    # --- Validate sources ---------------------------------------------------
    if "source" in ratings.columns:
        sources = set(ratings["source"].unique())
        logger.info("Rating sources found: %s", sources)
        if "movielens" not in sources:
            logger.warning("⚠️  'movielens' source NOT found in ratings!")
        if "indian_regional" not in sources:
            logger.warning("⚠️  'indian_regional' source NOT found in ratings!")
    else:
        logger.warning("⚠️  No 'source' column found in ratings — "
                        "cannot verify dataset composition.")

    # --- Validate required ID columns ---------------------------------------
    for col in ("global_user_id", "global_movie_id"):
        if col not in ratings.columns:
            raise ValueError(
                f"Required column '{col}' not found.  "
                f"Available columns: {list(ratings.columns)}"
            )

    # Log rating distribution per source
    if "source" in ratings.columns:
        for src in ratings["source"].unique():
            subset = ratings[ratings["source"] == src]
            logger.info(
                "  Source '%s': %d ratings, source_rating range [%s, %s]",
                src, len(subset),
                subset["source_rating"].min() if "source_rating" in subset.columns else "?",
                subset["source_rating"].max() if "source_rating" in subset.columns else "?",
            )

    return ratings


def load_movies(ratings: pd.DataFrame = None) -> pd.DataFrame:
    """
    Load combined_movies.csv.

    The file does NOT contain `global_movie_id`.  If a ratings DataFrame
    is provided, we build the mapping from (source_dataset, source_movie_id)
    to global_movie_id.
    """
    path = config.DATA_DIR / config.MOVIES_FILE
    if not path.exists():
        raise FileNotFoundError(f"Movie metadata file not found: {path}")

    movies = pd.read_csv(path)
    logger.info("Loaded movies: %d rows, columns: %s",
                len(movies), list(movies.columns))

    # Build global_movie_id by joining with ratings mapping
    if "global_movie_id" not in movies.columns:
        if ratings is not None and all(
            c in ratings.columns for c in ("source_dataset", "source_movie_id", "global_movie_id")
        ):
            # Get unique (source_dataset, source_movie_id) → global_movie_id mapping
            id_map = (
                ratings[["source_dataset", "source_movie_id", "global_movie_id"]]
                .drop_duplicates()
            )
            movies = movies.merge(
                id_map,
                on=["source_dataset", "source_movie_id"],
                how="left",
            )
            n_mapped = movies["global_movie_id"].notna().sum()
            logger.info(
                "Mapped %d / %d movies to global_movie_id",
                n_mapped, len(movies),
            )
            # Drop unmapped movies (they don't appear in any ratings)
            movies = movies.dropna(subset=["global_movie_id"])
            movies["global_movie_id"] = movies["global_movie_id"].astype(int)
        else:
            logger.warning(
                "Cannot create global_movie_id — no ratings DataFrame provided. "
                "Falling back to row index."
            )
            movies["global_movie_id"] = range(len(movies))

    return movies


def load_users(ratings: pd.DataFrame = None) -> pd.DataFrame:
    """
    Load combined_users.csv.

    The file does NOT contain `global_user_id`.  If a ratings DataFrame
    is provided, we build the mapping from (source_dataset, source_user_id)
    to global_user_id.
    """
    path = config.DATA_DIR / config.USERS_FILE
    if not path.exists():
        raise FileNotFoundError(f"User metadata file not found: {path}")

    users = pd.read_csv(path)
    logger.info("Loaded users: %d rows, columns: %s",
                len(users), list(users.columns))

    # Build global_user_id by joining with ratings mapping
    if "global_user_id" not in users.columns:
        if ratings is not None and all(
            c in ratings.columns for c in ("source_dataset", "source_user_id", "global_user_id")
        ):
            id_map = (
                ratings[["source_dataset", "source_user_id", "global_user_id"]]
                .drop_duplicates()
            )
            users = users.merge(
                id_map,
                on=["source_dataset", "source_user_id"],
                how="left",
            )
            n_mapped = users["global_user_id"].notna().sum()
            logger.info(
                "Mapped %d / %d users to global_user_id",
                n_mapped, len(users),
            )
            users = users.dropna(subset=["global_user_id"])
            users["global_user_id"] = users["global_user_id"].astype(int)
        else:
            logger.warning(
                "Cannot create global_user_id — no ratings DataFrame provided. "
                "Falling back to row index."
            )
            users["global_user_id"] = range(len(users))

    return users


def load_data_dictionary() -> pd.DataFrame:
    """Load data_dictionary.csv for reference."""
    path = config.DATA_DIR / config.DATA_DICT_FILE
    if not path.exists():
        logger.warning("Data dictionary not found at %s — skipping.", path)
        return pd.DataFrame()
    return pd.read_csv(path)


def validate_data_files() -> bool:
    """Check that all required data files exist."""
    all_ok = True

    # Rating chunks
    for name in config.RATING_CHUNKS:
        path = config.DATA_DIR / name
        if not path.exists():
            logger.error("MISSING: %s", path)
            all_ok = False
        else:
            size_mb = path.stat().st_size / (1024 * 1024)
            logger.info("OK: %s (%.1f MB)", path.name, size_mb)

    # Metadata files
    for name in (config.MOVIES_FILE, config.USERS_FILE):
        path = config.DATA_DIR / name
        if not path.exists():
            logger.error("MISSING: %s", path)
            all_ok = False
        else:
            size_mb = path.stat().st_size / (1024 * 1024)
            logger.info("OK: %s (%.1f MB)", path.name, size_mb)

    return all_ok


def load_all() -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Convenience: load ratings, movies, and users in one call.
    Ratings are loaded first so that movies and users can resolve
    their global IDs.

    Returns
    -------
    (ratings, movies, users)
    """
    ratings = load_ratings()
    movies = load_movies(ratings)
    users = load_users(ratings)
    return ratings, movies, users


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _ensure_column(df: pd.DataFrame, target: str, alternatives: list) -> None:
    """Rename the first matching alternative column to `target`."""
    if target in df.columns:
        return
    for alt in alternatives:
        if alt in df.columns:
            df.rename(columns={alt: target}, inplace=True)
            logger.info("Renamed column '%s' → '%s'", alt, target)
            return
