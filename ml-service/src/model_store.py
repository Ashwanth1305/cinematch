"""
CineMatch ML Engine — Model Store

Load / save all model artifacts and provide a unified interface for
the inference pipeline and the FastAPI service.
"""

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import joblib
import numpy as np
from scipy.sparse import csr_matrix, load_npz

from . import config

logger = logging.getLogger(__name__)


@dataclass
class ModelBundle:
    """Container holding all loaded model artifacts."""
    lightfm_model: object = None
    lightfm_dataset: object = None
    user_features: Optional[csr_matrix] = None
    item_features: Optional[csr_matrix] = None
    xgb_ranker: object = None
    user_mapping: Optional[Dict] = None
    movie_mapping: Optional[Dict] = None
    xgb_feature_columns: Optional[List[str]] = None
    model_metadata: Optional[Dict] = None
    is_loaded: bool = False


_bundle: Optional[ModelBundle] = None


def load_models() -> ModelBundle:
    """
    Load all trained model artifacts into memory.
    Returns a ModelBundle — individual components may be None
    if their artifact files are missing.
    """
    global _bundle
    bundle = ModelBundle()

    # --- LightFM ---
    try:
        bundle.lightfm_model = joblib.load(config.ARTIFACT_FILES["lightfm_model"])
        bundle.lightfm_dataset = joblib.load(config.ARTIFACT_FILES["lightfm_dataset"])
        bundle.user_features = load_npz(str(config.ARTIFACT_FILES["user_features"]))
        bundle.item_features = load_npz(str(config.ARTIFACT_FILES["item_features"]))
        logger.info("✓ LightFM model loaded")
    except Exception as e:
        logger.warning("LightFM artifacts not available: %s", e)

    # --- XGBRanker ---
    try:
        import xgboost as xgb
        ranker = xgb.XGBRanker()
        ranker.load_model(str(config.ARTIFACT_FILES["xgb_ranker"]))
        bundle.xgb_ranker = ranker
        logger.info("✓ XGBRanker model loaded")
    except Exception as e:
        logger.warning("XGBRanker not available: %s", e)

    # --- ID Mappings ---
    try:
        user_map = joblib.load(config.ARTIFACT_FILES["user_mapping"])
        movie_map = joblib.load(config.ARTIFACT_FILES["movie_mapping"])
        bundle.user_mapping = user_map
        bundle.movie_mapping = movie_map
        logger.info("✓ ID mappings loaded")
    except Exception as e:
        logger.warning("ID mappings not available: %s", e)

    # --- Feature columns ---
    try:
        with open(config.ARTIFACT_FILES["xgb_feature_columns"], "r") as f:
            bundle.xgb_feature_columns = json.load(f)
        logger.info("✓ XGB feature columns loaded (%d features)",
                     len(bundle.xgb_feature_columns))
    except Exception as e:
        logger.warning("XGB feature columns not available: %s", e)

    # --- Metadata ---
    try:
        with open(config.ARTIFACT_FILES["model_metadata"], "r") as f:
            bundle.model_metadata = json.load(f)
        logger.info("✓ Model metadata loaded")
    except Exception as e:
        logger.warning("Model metadata not available: %s", e)

    bundle.is_loaded = True
    _bundle = bundle
    return bundle


def get_bundle() -> ModelBundle:
    """Get the current model bundle, loading if needed."""
    global _bundle
    if _bundle is None or not _bundle.is_loaded:
        return load_models()
    return _bundle


def has_lightfm() -> bool:
    """Check if LightFM model is available."""
    b = get_bundle()
    return b.lightfm_model is not None and b.lightfm_dataset is not None


def has_xgb_ranker() -> bool:
    """Check if XGBRanker model is available."""
    b = get_bundle()
    return b.xgb_ranker is not None and b.xgb_feature_columns is not None


def save_model_metadata(metadata: Dict) -> None:
    """Save model metadata JSON."""
    path = config.ARTIFACT_FILES["model_metadata"]
    with open(path, "w") as f:
        json.dump(metadata, f, indent=2, default=str)
    logger.info("Model metadata saved to %s", path)


def save_feature_columns(columns: List[str]) -> None:
    """Save the ordered XGB feature column list."""
    path = config.ARTIFACT_FILES["xgb_feature_columns"]
    with open(path, "w") as f:
        json.dump(columns, f, indent=2)
    logger.info("Feature columns saved to %s", path)


def save_evaluation(data: Dict, name: str) -> None:
    """Save evaluation results JSON."""
    key = name  # e.g. "lightfm_evaluation", "xgb_evaluation", "model_comparison"
    if key in config.ARTIFACT_FILES:
        path = config.ARTIFACT_FILES[key]
    else:
        path = config.ARTIFACTS_DIR / f"{name}.json"
    with open(path, "w") as f:
        json.dump(data, f, indent=2, default=str)
    logger.info("Evaluation '%s' saved to %s", name, path)
