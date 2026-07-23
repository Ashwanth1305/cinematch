"""
CineMatch ML Engine — LightFM Trainer

Trains a LightFM hybrid model using WARP loss with:
- Positive user–movie interactions (sparse)
- User metadata features (sparse)
- Item metadata features (sparse)

Responsible for:
1. Building the LightFM Dataset
2. Creating interactions / weights sparse matrices
3. Building user_features / item_features sparse matrices
4. Training the model
5. Evaluating on a held-out set
6. Scoring candidate movies per user (for XGBRanker features)
7. Persisting all artifacts
"""

import logging
from typing import Dict, List, Optional, Tuple

import numpy as np
import joblib
from scipy.sparse import csr_matrix, save_npz, load_npz

try:
    from lightfm import LightFM
    from lightfm.data import Dataset
    LIGHTFM_AVAILABLE = True
except ImportError:
    LightFM = None
    Dataset = None
    LIGHTFM_AVAILABLE = False

from . import config

logger = logging.getLogger(__name__)

if not LIGHTFM_AVAILABLE:
    logger.warning(
        "LightFM is not installed — LightFM training/scoring will be skipped. "
        "Install with: pip install lightfm (requires Python ≤3.12)"
    )


# ---------------------------------------------------------------------------
# Build LightFM Dataset
# ---------------------------------------------------------------------------

def build_lightfm_dataset(
    all_user_ids: List,
    all_movie_ids: List,
    user_feature_vocab: List[str],
    item_feature_vocab: List[str],
) -> Dataset:
    """
    Fit a LightFM Dataset with all user/item IDs and feature vocabularies.
    """
    dataset = Dataset()
    dataset.fit(
        users=all_user_ids,
        items=all_movie_ids,
        user_features=user_feature_vocab,
        item_features=item_feature_vocab,
    )

    n_users, n_items = dataset.interactions_shape()
    logger.info(
        "LightFM Dataset fitted: %d users × %d items, "
        "%d user features, %d item features",
        n_users, n_items,
        len(user_feature_vocab), len(item_feature_vocab),
    )
    return dataset


# ---------------------------------------------------------------------------
# Build interaction matrices
# ---------------------------------------------------------------------------

def build_interactions(
    dataset: Dataset,
    positive_ratings: "pd.DataFrame",
    weights: np.ndarray,
) -> Tuple[csr_matrix, csr_matrix]:
    """
    Build (interactions, weights) sparse matrices for LightFM.

    Parameters
    ----------
    dataset : Dataset
        Fitted LightFM dataset.
    positive_ratings : pd.DataFrame
        Only positive interactions (see preprocessing.extract_positive_interactions).
    weights : np.ndarray
        Per-interaction weight values.

    Returns
    -------
    (interactions, interaction_weights)
    """
    interaction_data = list(zip(
        positive_ratings["global_user_id"],
        positive_ratings["global_movie_id"],
    ))

    weight_data = list(zip(
        positive_ratings["global_user_id"],
        positive_ratings["global_movie_id"],
        weights,
    ))

    interactions, _ = dataset.build_interactions(interaction_data)
    _, interaction_weights = dataset.build_interactions(weight_data)

    logger.info(
        "Interactions matrix: shape %s, nnz %d",
        interactions.shape, interactions.nnz,
    )
    return interactions, interaction_weights


# ---------------------------------------------------------------------------
# Build feature matrices
# ---------------------------------------------------------------------------

def build_feature_matrices(
    dataset: Dataset,
    user_feature_tokens: Dict[int, List[str]],
    item_feature_tokens: Dict[int, List[str]],
) -> Tuple[csr_matrix, csr_matrix]:
    """
    Build sparse user_features and item_features matrices.
    """
    # User features
    user_features_data = []
    for uid, tokens in user_feature_tokens.items():
        if tokens:
            user_features_data.append((uid, tokens))

    if user_features_data:
        user_features = dataset.build_user_features(user_features_data, normalize=True)
    else:
        user_features = dataset.build_user_features([], normalize=True)

    # Item features
    item_features_data = []
    for mid, tokens in item_feature_tokens.items():
        if tokens:
            item_features_data.append((mid, tokens))

    if item_features_data:
        item_features = dataset.build_item_features(item_features_data, normalize=True)
    else:
        item_features = dataset.build_item_features([], normalize=True)

    logger.info(
        "User features: %s, Item features: %s",
        user_features.shape, item_features.shape,
    )
    return user_features, item_features


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

def train_lightfm(
    interactions: csr_matrix,
    interaction_weights: csr_matrix,
    user_features: csr_matrix,
    item_features: csr_matrix,
    cfg: config.LightFMConfig = None,
) -> LightFM:
    """
    Train a LightFM model with WARP loss.
    """
    if cfg is None:
        cfg = config.LightFMConfig()

    model = LightFM(
        loss=cfg.loss,
        no_components=cfg.no_components,
        learning_rate=cfg.learning_rate,
        user_alpha=cfg.user_alpha,
        item_alpha=cfg.item_alpha,
        random_state=cfg.random_state,
    )

    logger.info(
        "Training LightFM: %d epochs, %d components, loss=%s",
        cfg.epochs, cfg.no_components, cfg.loss,
    )

    for epoch in range(1, cfg.epochs + 1):
        model.fit_partial(
            interactions,
            sample_weight=interaction_weights,
            user_features=user_features,
            item_features=item_features,
            num_threads=cfg.num_threads,
            epochs=1,
        )
        if epoch % 5 == 0 or epoch == cfg.epochs:
            logger.info("  Epoch %d / %d complete", epoch, cfg.epochs)

    return model


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def score_candidates(
    model: LightFM,
    dataset: Dataset,
    user_id,
    candidate_movie_ids: List,
    user_features: csr_matrix,
    item_features: csr_matrix,
) -> np.ndarray:
    """
    Score a list of candidate movies for a single user.

    Returns
    -------
    np.ndarray
        Array of scores, one per candidate movie (same order).
    """
    # Map external IDs to internal indices
    user_id_map, _, item_id_map, _ = _get_dataset_mappings(dataset)

    if user_id not in user_id_map:
        # Unknown user — return zeros
        return np.zeros(len(candidate_movie_ids), dtype=np.float32)

    internal_uid = user_id_map[user_id]

    # Map candidate items
    internal_iids = []
    valid_mask = []
    for mid in candidate_movie_ids:
        if mid in item_id_map:
            internal_iids.append(item_id_map[mid])
            valid_mask.append(True)
        else:
            internal_iids.append(0)  # placeholder
            valid_mask.append(False)

    internal_iids = np.array(internal_iids, dtype=np.int32)

    # Predict
    scores = model.predict(
        user_ids=internal_uid,
        item_ids=internal_iids,
        user_features=user_features,
        item_features=item_features,
        num_threads=1,
    )

    # Zero out scores for unknown items
    scores = scores.astype(np.float32)
    for i, valid in enumerate(valid_mask):
        if not valid:
            scores[i] = 0.0

    return scores


def score_all_items_for_user(
    model: LightFM,
    dataset: Dataset,
    user_id,
    user_features: csr_matrix,
    item_features: csr_matrix,
    n_items: int,
) -> np.ndarray:
    """
    Score ALL items for a single user.  Returns array of shape (n_items,).
    """
    user_id_map, _, _, _ = _get_dataset_mappings(dataset)

    if user_id not in user_id_map:
        return np.zeros(n_items, dtype=np.float32)

    internal_uid = user_id_map[user_id]
    all_item_ids = np.arange(n_items, dtype=np.int32)

    scores = model.predict(
        user_ids=internal_uid,
        item_ids=all_item_ids,
        user_features=user_features,
        item_features=item_features,
        num_threads=1,
    )
    return scores.astype(np.float32)


def get_top_candidates(
    model: LightFM,
    dataset: Dataset,
    user_id,
    user_features: csr_matrix,
    item_features: csr_matrix,
    n_items: int,
    top_k: int = 200,
    exclude_item_ids: Optional[set] = None,
) -> List[Tuple[int, float]]:
    """
    Get top-K candidate items for a user based on LightFM scores.

    Returns
    -------
    List of (internal_item_id, score) tuples, sorted descending by score.
    """
    scores = score_all_items_for_user(
        model, dataset, user_id, user_features, item_features, n_items,
    )

    _, _, _, idx_to_item = _get_dataset_mappings(dataset)

    # Build (external_id, score) and filter
    candidates = []
    for internal_iid in range(n_items):
        external_mid = idx_to_item.get(internal_iid)
        if external_mid is None:
            continue
        if exclude_item_ids and external_mid in exclude_item_ids:
            continue
        candidates.append((external_mid, float(scores[internal_iid])))

    candidates.sort(key=lambda x: x[1], reverse=True)
    return candidates[:top_k]


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def save_lightfm_artifacts(
    model: LightFM,
    dataset: Dataset,
    user_features: csr_matrix,
    item_features: csr_matrix,
) -> None:
    """Save all LightFM artifacts to disk."""
    joblib.dump(model, config.ARTIFACT_FILES["lightfm_model"])
    joblib.dump(dataset, config.ARTIFACT_FILES["lightfm_dataset"])
    save_npz(str(config.ARTIFACT_FILES["user_features"]), user_features)
    save_npz(str(config.ARTIFACT_FILES["item_features"]), item_features)
    logger.info("LightFM artifacts saved to %s", config.ARTIFACTS_DIR)


def load_lightfm_artifacts() -> Tuple[LightFM, Dataset, csr_matrix, csr_matrix]:
    """Load all LightFM artifacts from disk."""
    model = joblib.load(config.ARTIFACT_FILES["lightfm_model"])
    dataset = joblib.load(config.ARTIFACT_FILES["lightfm_dataset"])
    user_features = load_npz(str(config.ARTIFACT_FILES["user_features"]))
    item_features = load_npz(str(config.ARTIFACT_FILES["item_features"]))
    logger.info("LightFM artifacts loaded from %s", config.ARTIFACTS_DIR)
    return model, dataset, user_features, item_features


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_dataset_mappings(dataset: Dataset):
    """
    Extract internal ↔ external ID mappings from a LightFM Dataset.

    Returns (user_to_idx, idx_to_user, item_to_idx, idx_to_item)
    """
    user_id_map, _, item_id_map, _ = dataset.mapping()

    idx_to_user = {v: k for k, v in user_id_map.items()}
    idx_to_item = {v: k for k, v in item_id_map.items()}

    return user_id_map, idx_to_user, item_id_map, idx_to_item
