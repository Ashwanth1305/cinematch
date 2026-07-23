"""
CineMatch ML Engine — XGBRanker Trainer

Trains an XGBoost learning-to-rank model with rank:ndcg objective.
Handles grouped observations, early stopping, and artifact persistence.
"""

import json
import logging
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import xgboost as xgb

from . import config
from .model_store import save_feature_columns

logger = logging.getLogger(__name__)


def train_xgb_ranker(
    X_train: np.ndarray,
    y_train: np.ndarray,
    train_group_sizes: np.ndarray,
    X_val: Optional[np.ndarray] = None,
    y_val: Optional[np.ndarray] = None,
    val_group_sizes: Optional[np.ndarray] = None,
    feature_columns: Optional[List[str]] = None,
    cfg: config.XGBRankerConfig = None,
) -> xgb.XGBRanker:
    """
    Train an XGBRanker model.

    Parameters
    ----------
    X_train, y_train : np.ndarray
        Training features and relevance labels.
    train_group_sizes : np.ndarray
        Number of candidates per user in training data.
    X_val, y_val : np.ndarray, optional
        Validation features and labels.
    val_group_sizes : np.ndarray, optional
        Number of candidates per user in validation data.
    feature_columns : list of str, optional
        Ordered feature names — saved as an artifact.
    cfg : XGBRankerConfig

    Returns
    -------
    xgb.XGBRanker
    """
    if cfg is None:
        cfg = config.XGBRankerConfig()

    logger.info(
        "Training XGBRanker: %d estimators, lr=%.3f, depth=%d, "
        "%d training rows, %d groups",
        cfg.n_estimators, cfg.learning_rate, cfg.max_depth,
        len(X_train), len(train_group_sizes),
    )

    # Validate group sizes
    assert train_group_sizes.sum() == len(X_train), (
        f"Group sizes sum ({train_group_sizes.sum()}) != "
        f"training rows ({len(X_train)})"
    )

    ranker = xgb.XGBRanker(
        objective=cfg.objective,
        n_estimators=cfg.n_estimators,
        learning_rate=cfg.learning_rate,
        max_depth=cfg.max_depth,
        min_child_weight=cfg.min_child_weight,
        subsample=cfg.subsample,
        colsample_bytree=cfg.colsample_bytree,
        reg_alpha=cfg.reg_alpha,
        reg_lambda=cfg.reg_lambda,
        random_state=cfg.random_state,
        tree_method=cfg.tree_method,
    )

    fit_params = {
        "X": X_train,
        "y": y_train,
        "group": train_group_sizes,
        "verbose": True,
    }

    if X_val is not None and y_val is not None and val_group_sizes is not None:
        assert val_group_sizes.sum() == len(X_val), (
            f"Val group sizes sum ({val_group_sizes.sum()}) != "
            f"validation rows ({len(X_val)})"
        )
        fit_params["eval_set"] = [(X_val, y_val)]
        fit_params["eval_group"] = [val_group_sizes]

    # Try early stopping — API varies by xgboost version
    try:
        ranker.set_params(early_stopping_rounds=cfg.early_stopping_rounds)
        logger.info("Early stopping enabled: %d rounds", cfg.early_stopping_rounds)
    except (TypeError, xgb.core.XGBoostError):
        logger.info("Early stopping not supported in this XGBoost version")

    ranker.fit(**fit_params)

    # Log feature importances
    if feature_columns:
        _log_feature_importances(ranker, feature_columns)
        save_feature_columns(feature_columns)

    return ranker


def save_xgb_ranker(ranker: xgb.XGBRanker) -> None:
    """Save the XGBRanker model in native JSON format."""
    path = str(config.ARTIFACT_FILES["xgb_ranker"])
    ranker.save_model(path)
    logger.info("XGBRanker saved to %s", path)


def load_xgb_ranker() -> xgb.XGBRanker:
    """Load a saved XGBRanker model."""
    path = str(config.ARTIFACT_FILES["xgb_ranker"])
    ranker = xgb.XGBRanker()
    ranker.load_model(path)
    logger.info("XGBRanker loaded from %s", path)
    return ranker


def predict_scores(
    ranker: xgb.XGBRanker,
    X: np.ndarray,
) -> np.ndarray:
    """
    Predict ranking scores for a feature matrix.

    Returns
    -------
    np.ndarray
        Raw ranking scores (not probabilities — must be normalised).
    """
    return ranker.predict(X).astype(np.float32)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _log_feature_importances(
    ranker: xgb.XGBRanker,
    feature_columns: List[str],
) -> None:
    """Log top feature importances."""
    try:
        importances = ranker.feature_importances_
        pairs = sorted(
            zip(feature_columns, importances),
            key=lambda x: x[1],
            reverse=True,
        )
        logger.info("Feature importances (top 10):")
        for name, imp in pairs[:10]:
            logger.info("  %s: %.4f", name, imp)
    except Exception as e:
        logger.warning("Could not retrieve feature importances: %s", e)
