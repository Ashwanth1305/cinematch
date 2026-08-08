"""
CineMatch ML Engine — Centralized Configuration

All hyperparameters, file paths, feature cardinality limits,
relevance mappings, and blending weights are defined here.
Every value is configurable via environment variables or direct override.
"""

import os
from pathlib import Path
from dataclasses import dataclass, field
from typing import Dict, List, Tuple
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Directory layout & Environment Loading
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
ROOT_ENV_FILE = PROJECT_ROOT.parent / ".env"

if ROOT_ENV_FILE.exists():
    load_dotenv(ROOT_ENV_FILE)
else:
    load_dotenv()
# Data lives in the sibling dataset directory, NOT inside ml-service/data/
DATA_DIR = Path(os.getenv(
    "CINEMATCH_DATA_DIR",
    str(PROJECT_ROOT.parent / "dataset" / "cinematch_combined"),
))
ARTIFACTS_DIR = PROJECT_ROOT / "artifacts"

# Ensure artifacts directory exists
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Data files  — plain CSV (NOT gzipped)
# ---------------------------------------------------------------------------
RATING_CHUNKS: List[str] = [
    "part_aa_with_header.csv",
    "part_ab_with_header.csv",
    "part_ac_with_header.csv",
    "part_ad_with_header.csv",
    "part_ae_with_header.csv",
    "part_af_with_header.csv",
]

MOVIES_FILE = "combined_movies.csv"
USERS_FILE = "combined_users.csv"
DATA_DICT_FILE = "data_dictionary.csv"

# ---------------------------------------------------------------------------
# Actual column names in the dataset
# ---------------------------------------------------------------------------
# Ratings columns:
#   global_user_id, global_movie_id, normalized_rating, source_rating,
#   source_dataset, source_user_id, source_movie_id, timestamp, preference_label
#
# Movies columns:
#   source_dataset, source_movie_id, title, release_year, genres, languages,
#   description, aggregate_rating, writers, directors, cast
#   NOTE: No global_movie_id — must be created by joining with ratings
#
# Users columns:
#   source_dataset, source_user_id, languages, occupation, state,
#   date_of_birth, gender
#   NOTE: No global_user_id — must be created by joining with ratings

COL_RATING = "normalized_rating"  # 0.0–1.0 continuous
COL_SOURCE_RATING = "source_rating"  # original scale (movielens 0.5-5, indian 1/0/-1)
COL_SOURCE = "source_dataset"
COL_GLOBAL_USER = "global_user_id"
COL_GLOBAL_MOVIE = "global_movie_id"
COL_SOURCE_USER = "source_user_id"
COL_SOURCE_MOVIE = "source_movie_id"
COL_TIMESTAMP = "timestamp"
COL_PREF_LABEL = "preference_label"  # like/neutral/dislike


# ---------------------------------------------------------------------------
# Relevance label mappings  (configurable)
# ---------------------------------------------------------------------------
# MovieLens: original 0.5–5.0 scale → relevance 0–4
MOVIELENS_RELEVANCE: Dict[str, int] = {
    # rating range → relevance
    "4.5-5.0": 4,
    "4.0":     3,
    "3.0-3.5": 1,
    "below_3": 0,
}

# Indian Regional: 1/0/-1 → relevance
INDIAN_RELEVANCE: Dict[int, int] = {
    1:  4,   # like
    0:  1,   # neutral
    -1: 0,   # dislike
}

# preference_label → relevance (alternative mapping)
PREF_LABEL_RELEVANCE: Dict[str, int] = {
    "like":    4,
    "neutral": 1,
    "dislike": 0,
}


def movielens_rating_to_relevance(rating: float) -> int:
    """Convert a MovieLens 0.5-5.0 rating to a relevance label 0-4."""
    if rating >= 4.5:
        return 4
    elif rating >= 4.0:
        return 3
    elif rating >= 3.0:
        return 1
    else:
        return 0


def indian_rating_to_relevance(rating: int) -> int:
    """Convert an Indian Regional rating (1/0/-1) to a relevance label."""
    return INDIAN_RELEVANCE.get(rating, 0)


def preference_label_to_relevance(label: str) -> int:
    """Convert a preference_label string to relevance (0-4)."""
    return PREF_LABEL_RELEVANCE.get(str(label).strip().lower(), 1)


# What counts as a *positive* interaction for LightFM
# MovieLens: source_rating >= 3.0   Indian: source_rating == 1
MOVIELENS_POSITIVE_THRESHOLD = 3.0
INDIAN_POSITIVE_VALUE = 1


# ---------------------------------------------------------------------------
# Source interaction weights  (configurable)
# ---------------------------------------------------------------------------
SOURCE_WEIGHTS = {
    "movielens":       float(os.getenv("MOVIELENS_WEIGHT", "1.0")),
    "indian_regional": float(os.getenv("INDIAN_WEIGHT", "5.0")),
}


# ---------------------------------------------------------------------------
# Feature cardinality limits
# ---------------------------------------------------------------------------
MAX_ACTORS = int(os.getenv("MAX_ACTORS", "5000"))
MAX_DIRECTORS = int(os.getenv("MAX_DIRECTORS", "2000"))


# ---------------------------------------------------------------------------
# Age-band mapping
# ---------------------------------------------------------------------------
AGE_BANDS: List[Tuple[int, int, str]] = [
    (0, 17,  "under_18"),
    (18, 24, "18_24"),
    (25, 34, "25_34"),
    (35, 44, "35_44"),
    (45, 54, "45_54"),
    (55, 200, "55_plus"),
]

AGE_BAND_UNKNOWN = "unknown"


def dob_to_age_band(dob_str: str | None, reference_year: int = 2025) -> str:
    """Convert date-of-birth string to an age band label."""
    if not dob_str or str(dob_str).strip() in ("", "nan", "None", "NaT"):
        return AGE_BAND_UNKNOWN
    try:
        from datetime import datetime
        dob = datetime.strptime(str(dob_str).strip()[:10], "%Y-%m-%d")
        age = reference_year - dob.year
        for lo, hi, label in AGE_BANDS:
            if lo <= age <= hi:
                return label
        return "55_plus" if age > 54 else AGE_BAND_UNKNOWN
    except Exception:
        return AGE_BAND_UNKNOWN


# ---------------------------------------------------------------------------
# LightFM hyperparameters
# ---------------------------------------------------------------------------
@dataclass
class LightFMConfig:
    loss: str = "warp"
    no_components: int = 64
    learning_rate: float = 0.05
    user_alpha: float = 1e-6
    item_alpha: float = 1e-6
    random_state: int = 42
    epochs: int = int(os.getenv("LIGHTFM_EPOCHS", "30"))
    num_threads: int = int(os.getenv("LIGHTFM_THREADS", "4"))
    candidate_top_k: int = int(os.getenv("LIGHTFM_CANDIDATE_K", "200"))


# ---------------------------------------------------------------------------
# XGBRanker hyperparameters
# ---------------------------------------------------------------------------
@dataclass
class XGBRankerConfig:
    objective: str = "rank:ndcg"
    eval_metric: str = "ndcg@10"
    n_estimators: int = int(os.getenv("XGB_ESTIMATORS", "500"))
    learning_rate: float = float(os.getenv("XGB_LR", "0.05"))
    max_depth: int = int(os.getenv("XGB_MAX_DEPTH", "8"))
    min_child_weight: int = int(os.getenv("XGB_MIN_CHILD", "5"))
    subsample: float = 0.8
    colsample_bytree: float = 0.8
    reg_alpha: float = 0.1
    reg_lambda: float = 1.0
    random_state: int = 42
    tree_method: str = "hist"
    early_stopping_rounds: int = int(os.getenv("XGB_EARLY_STOP", "50"))


# ---------------------------------------------------------------------------
# Negative sampling
# ---------------------------------------------------------------------------
NEGATIVE_RATIO = int(os.getenv("NEGATIVE_RATIO", "7"))  # negatives per positive
NEGATIVE_MIX = {
    "random":       0.50,
    "popular":      0.20,
    "genre_hard":   0.15,
    "language_hard": 0.10,
    "lightfm_hard": 0.05,
}


# ---------------------------------------------------------------------------
# Train / Validation / Test split ratios  (per-user)
# ---------------------------------------------------------------------------
TRAIN_RATIO = 0.80
VAL_RATIO = 0.10
TEST_RATIO = 0.10


# ---------------------------------------------------------------------------
# Hybrid blending  (FIXED — do not change dynamically)
# ---------------------------------------------------------------------------
RULE_WEIGHT = 0.60
MODEL_WEIGHT = 0.40


# ---------------------------------------------------------------------------
# XGBRanker feature columns  (ordered)
# ---------------------------------------------------------------------------
XGB_FEATURE_COLUMNS: List[str] = [
    "lightfm_score",
    "rule_based_score",
    "genre_affinity_score",
    "language_match_score",
    "actor_match_score",
    "director_match_score",
    "keyword_similarity_score",
    "normalized_movie_rating",
    "normalized_movie_popularity",
    "release_recency_score",
    "movie_interaction_count",
    "user_interaction_count",
    "movie_average_rating",
    "user_average_rating",
    "metadata_completeness",
    "source_dataset",
    "is_indian_content",
    "is_cold_start_movie",
    "lightfm_score_missing",
    "negative_feedback_count",
]


# ---------------------------------------------------------------------------
# Artifact file names
# ---------------------------------------------------------------------------
ARTIFACT_FILES = {
    "lightfm_model":       ARTIFACTS_DIR / "lightfm_model.pkl",
    "xgb_ranker":          ARTIFACTS_DIR / "xgb_ranker.json",
    "user_mapping":        ARTIFACTS_DIR / "user_mapping.pkl",
    "movie_mapping":       ARTIFACTS_DIR / "movie_mapping.pkl",
    "user_features":       ARTIFACTS_DIR / "user_features.npz",
    "item_features":       ARTIFACTS_DIR / "item_features.npz",
    "lightfm_dataset":     ARTIFACTS_DIR / "lightfm_dataset.pkl",
    "xgb_feature_columns": ARTIFACTS_DIR / "xgb_feature_columns.json",
    "model_metadata":      ARTIFACTS_DIR / "model_metadata.json",
    "lightfm_evaluation":  ARTIFACTS_DIR / "lightfm_evaluation.json",
    "xgb_evaluation":      ARTIFACTS_DIR / "xgb_evaluation.json",
    "model_comparison":    ARTIFACTS_DIR / "model_comparison.json",
}


# ---------------------------------------------------------------------------
# FastAPI
# ---------------------------------------------------------------------------
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8000"))
ML_SERVICE_URL = os.getenv("ML_SERVICE_URL", "http://localhost:8000")
ML_SERVICE_TIMEOUT = int(os.getenv("ML_SERVICE_TIMEOUT", "5"))  # seconds
