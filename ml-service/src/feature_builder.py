"""
CineMatch ML Engine — Feature Builder

Constructs sparse feature matrices for LightFM from movie and user metadata.

Movie features: genre, language, director (top-2000), cast (top-5000),
                release decade, source dataset.
User features:  known languages, occupation, state, age band, source dataset.

Also provides helper functions for building dense ranking features
used by XGBRanker.
"""

import logging
import re
from collections import Counter
from typing import Dict, List, Optional, Set, Tuple

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix

from . import config

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Utility: normalise a string into a feature token
# ---------------------------------------------------------------------------

def _tokenize(value: str) -> str:
    """Lower-case, strip, replace spaces/special chars with underscores."""
    s = str(value).strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_")


def _safe_split(value, sep: str = "|") -> List[str]:
    """Split a string value on a separator, handling NaN and lists.

    Default separator is '|' to match the CineMatch dataset format
    (e.g., 'Action|Comedy|Drama').
    """
    if pd.isna(value) or str(value).strip() in ("", "nan", "None", "[]"):
        return []
    s = str(value).strip()
    # Handle JSON-style lists
    if s.startswith("[") and s.endswith("]"):
        s = s[1:-1]
    items = [x.strip().strip("'\"") for x in s.split(sep)]
    return [x for x in items if x]


# ---------------------------------------------------------------------------
# Movie feature tokens
# ---------------------------------------------------------------------------

def build_movie_feature_tokens(
    movies: pd.DataFrame,
    top_actors: int = config.MAX_ACTORS,
    top_directors: int = config.MAX_DIRECTORS,
) -> Tuple[Dict[int, List[str]], List[str]]:
    """
    Build a dict mapping global_movie_id → list of feature token strings.

    Also returns the full vocabulary of feature tokens across all movies.
    """
    # --- Discover top-k actors and directors --------------------------------
    actor_counter: Counter = Counter()
    director_counter: Counter = Counter()

    for _, row in movies.iterrows():
        # Cast
        cast_col = _find_col(movies, ["cast", "cast_members", "actors", "top_cast"])
        if cast_col:
            for actor in _safe_split(row.get(cast_col, "")):
                token = _tokenize(actor)
                if token:
                    actor_counter[token] += 1

        # Director
        dir_col = _find_col(movies, ["director", "directors"])
        if dir_col:
            for d in _safe_split(row.get(dir_col, "")):
                token = _tokenize(d)
                if token:
                    director_counter[token] += 1

    allowed_actors = {a for a, _ in actor_counter.most_common(top_actors)}
    allowed_directors = {d for d, _ in director_counter.most_common(top_directors)}
    logger.info("Allowed actors: %d / %d unique, directors: %d / %d unique",
                len(allowed_actors), len(actor_counter),
                len(allowed_directors), len(director_counter))

    # --- Build per-movie feature lists --------------------------------------
    movie_features: Dict[int, List[str]] = {}
    vocab: Set[str] = set()

    genre_col = _find_col(movies, ["genres", "genre", "genre_ids"])
    lang_col = _find_col(movies, ["languages", "language", "original_language", "lang"])
    dir_col = _find_col(movies, ["director", "directors"])
    cast_col = _find_col(movies, ["cast", "cast_members", "actors", "top_cast"])
    year_col = _find_col(movies, ["release_year", "year", "release_date"])
    source_col = _find_col(movies, ["source", "source_dataset", "dataset"])

    for _, row in movies.iterrows():
        mid = row["global_movie_id"]
        tokens: List[str] = []

        # Genres  (all)
        if genre_col:
            for g in _safe_split(row.get(genre_col, "")):
                t = f"genre:{_tokenize(g)}"
                if t != "genre:":
                    tokens.append(t)

        # Languages  (all)
        if lang_col:
            for lang in _safe_split(row.get(lang_col, "")):
                t = f"language:{_tokenize(lang)}"
                if t != "language:":
                    tokens.append(t)

        # Directors  (top-k)
        if dir_col:
            for d in _safe_split(row.get(dir_col, "")):
                tok = _tokenize(d)
                if tok in allowed_directors:
                    tokens.append(f"director:{tok}")

        # Cast  (top-k)
        if cast_col:
            for a in _safe_split(row.get(cast_col, "")):
                tok = _tokenize(a)
                if tok in allowed_actors:
                    tokens.append(f"cast:{tok}")

        # Release decade
        if year_col:
            raw = row.get(year_col, "")
            year = _extract_year(raw)
            if year:
                decade = (year // 10) * 10
                tokens.append(f"decade:{decade}")

        # Source dataset
        if source_col:
            src = _tokenize(str(row.get(source_col, "")))
            if src:
                tokens.append(f"source:{src}")

        movie_features[mid] = tokens
        vocab.update(tokens)

    logger.info("Movie features built: %d movies, %d unique tokens",
                len(movie_features), len(vocab))
    return movie_features, sorted(vocab)


# ---------------------------------------------------------------------------
# User feature tokens
# ---------------------------------------------------------------------------

def build_user_feature_tokens(
    users: pd.DataFrame,
) -> Tuple[Dict[int, List[str]], List[str]]:
    """
    Build a dict mapping global_user_id → list of feature token strings.
    """
    user_features: Dict[int, List[str]] = {}
    vocab: Set[str] = set()

    lang_col = _find_col(users, ["known_languages", "languages", "language", "lang"])
    occ_col = _find_col(users, ["occupation", "job", "profession"])
    state_col = _find_col(users, ["state", "region", "location"])
    dob_col = _find_col(users, ["date_of_birth", "dob", "birth_date", "age", "birth_year"])
    source_col = _find_col(users, ["source", "source_dataset", "dataset"])

    for _, row in users.iterrows():
        uid = row["global_user_id"]
        tokens: List[str] = []

        # Languages
        if lang_col:
            for lang in _safe_split(row.get(lang_col, "")):
                t = f"user_language:{_tokenize(lang)}"
                if t != "user_language:":
                    tokens.append(t)

        # Occupation
        if occ_col:
            occ = _tokenize(str(row.get(occ_col, "")))
            if occ and occ != "nan":
                tokens.append(f"occupation:{occ}")

        # State
        if state_col:
            st = _tokenize(str(row.get(state_col, "")))
            if st and st != "nan":
                tokens.append(f"state:{st}")

        # Age band  (gender excluded per spec)
        if dob_col:
            band = config.dob_to_age_band(row.get(dob_col))
            tokens.append(f"age:{band}")

        # Source dataset
        if source_col:
            src = _tokenize(str(row.get(source_col, "")))
            if src:
                tokens.append(f"user_source:{src}")

        user_features[uid] = tokens
        vocab.update(tokens)

    logger.info("User features built: %d users, %d unique tokens",
                len(user_features), len(vocab))
    return user_features, sorted(vocab)


# ---------------------------------------------------------------------------
# Dense ranking features for XGBRanker
# ---------------------------------------------------------------------------

def compute_movie_stats(
    ratings: pd.DataFrame,
) -> pd.DataFrame:
    """
    Compute per-movie aggregate statistics:
    interaction_count, average_rating, negative_feedback_count.
    """
    stats = (
        ratings
        .groupby("global_movie_id")
        .agg(
            movie_interaction_count=("rating", "count"),
            movie_average_rating=("rating", "mean"),
            negative_feedback_count=("relevance", lambda x: (x == 0).sum()),
        )
        .reset_index()
    )
    return stats


def compute_user_stats(
    ratings: pd.DataFrame,
) -> pd.DataFrame:
    """Compute per-user aggregate statistics."""
    stats = (
        ratings
        .groupby("global_user_id")
        .agg(
            user_interaction_count=("rating", "count"),
            user_average_rating=("rating", "mean"),
        )
        .reset_index()
    )
    return stats


def compute_metadata_completeness(movies: pd.DataFrame) -> pd.Series:
    """
    Fraction of non-null metadata fields per movie.
    """
    meta_cols = [c for c in movies.columns if c != "global_movie_id"]
    if not meta_cols:
        return pd.Series(0.5, index=movies.index)
    completeness = movies[meta_cols].notna().mean(axis=1)
    return completeness


def compute_release_recency(
    movies: pd.DataFrame,
    reference_year: int = 2025,
) -> pd.Series:
    """
    A 0–1 score: 1.0 for this year, decaying for older movies.
    Uses a sigmoid-style decay.
    """
    year_col = _find_col(movies, ["release_year", "year", "release_date"])
    if not year_col:
        return pd.Series(0.5, index=movies.index)

    years = movies[year_col].apply(lambda v: _extract_year(v) or reference_year - 20)
    age = reference_year - years
    recency = 1.0 / (1.0 + np.exp(0.15 * (age - 5)))  # sigmoid centered at 5 years
    return recency.astype(np.float32)


def normalize_series(s: pd.Series) -> pd.Series:
    """Min-max normalize a series to [0, 1]."""
    mn, mx = s.min(), s.max()
    if mx == mn:
        return pd.Series(0.5, index=s.index, dtype=np.float32)
    return ((s - mn) / (mx - mn)).astype(np.float32)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _find_col(df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
    """Return the first matching column name or None."""
    for c in candidates:
        if c in df.columns:
            return c
    return None


def _extract_year(value) -> Optional[int]:
    """Try to extract a 4-digit year from various formats."""
    if pd.isna(value):
        return None
    s = str(value).strip()
    # Full date: 2020-01-15
    match = re.match(r"(\d{4})", s)
    if match:
        y = int(match.group(1))
        if 1900 <= y <= 2030:
            return y
    return None
