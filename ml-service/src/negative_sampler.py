"""
CineMatch ML Engine — Negative Sampler

Creates synthetic negative candidates for XGBRanker training.

For each positive interaction, samples ~NEGATIVE_RATIO unrated movies
using a configurable mix of strategies:

  50 %  random unrated movies
  20 %  popular unrated movies
  15 %  genre-similar hard negatives
  10 %  language-similar hard negatives
   5 %  high-LightFM-score but unobserved

Negatives get relevance = 0 and are flagged as synthetic.
"""

import logging
from typing import Dict, List, Optional, Set, Tuple

import numpy as np
import pandas as pd

from . import config

logger = logging.getLogger(__name__)


def sample_negatives(
    positive_df: pd.DataFrame,
    all_movie_ids: np.ndarray,
    movie_features: Dict[int, List[str]],
    movie_popularity: Dict[int, float],
    lightfm_scores: Optional[Dict[int, Dict[int, float]]] = None,
    negative_ratio: int = config.NEGATIVE_RATIO,
    mix: Dict[str, float] = None,
    random_state: int = 42,
) -> pd.DataFrame:
    """
    Generate synthetic negative samples for XGBRanker training.

    Parameters
    ----------
    positive_df : pd.DataFrame
        DataFrame of positive interactions with columns:
        global_user_id, global_movie_id, relevance, source, …
    all_movie_ids : np.ndarray
        All known movie IDs in the dataset.
    movie_features : dict
        global_movie_id → list of feature tokens (e.g., ["genre:action", …]).
    movie_popularity : dict
        global_movie_id → popularity score (e.g., interaction count).
    lightfm_scores : dict, optional
        {user_id: {movie_id: score}} — LightFM predictions for users.
    negative_ratio : int
        Number of negatives per positive interaction.
    mix : dict
        Strategy mix ratios.
    random_state : int

    Returns
    -------
    pd.DataFrame
        Negative samples with relevance=0 and is_synthetic_negative=True.
    """
    if mix is None:
        mix = config.NEGATIVE_MIX

    rng = np.random.RandomState(random_state)

    # Pre-compute per-user positive sets
    user_positives: Dict = {}
    for uid, group in positive_df.groupby("global_user_id"):
        user_positives[uid] = set(group["global_movie_id"].values)

    # Pre-compute genre and language indexes for hard negatives
    genre_index = _build_feature_index(movie_features, "genre:")
    language_index = _build_feature_index(movie_features, "language:")

    # Movie popularity ranks for popular sampling
    all_movie_set = set(all_movie_ids)
    pop_sorted = sorted(
        movie_popularity.items(), key=lambda x: x[1], reverse=True
    )
    pop_movie_ids = np.array([mid for mid, _ in pop_sorted])
    pop_weights = np.array([p for _, p in pop_sorted], dtype=np.float64)
    if pop_weights.sum() > 0:
        pop_weights /= pop_weights.sum()

    # Number of negatives per strategy
    n_random = max(1, int(negative_ratio * mix.get("random", 0.5)))
    n_popular = max(0, int(negative_ratio * mix.get("popular", 0.2)))
    n_genre = max(0, int(negative_ratio * mix.get("genre_hard", 0.15)))
    n_language = max(0, int(negative_ratio * mix.get("language_hard", 0.10)))
    n_lightfm = max(0, int(negative_ratio * mix.get("lightfm_hard", 0.05)))

    # Ensure total roughly matches negative_ratio
    total_target = negative_ratio
    n_random = total_target - n_popular - n_genre - n_language - n_lightfm
    n_random = max(1, n_random)

    negative_rows = []
    all_movie_arr = np.array(list(all_movie_set))

    users = positive_df["global_user_id"].unique()
    logger.info(
        "Sampling negatives for %d users, ratio=%d (r:%d p:%d g:%d l:%d lf:%d)",
        len(users), negative_ratio,
        n_random, n_popular, n_genre, n_language, n_lightfm,
    )

    for user_idx, uid in enumerate(users):
        if user_idx % 10000 == 0 and user_idx > 0:
            logger.info("  Processed %d / %d users", user_idx, len(users))

        pos_set = user_positives.get(uid, set())
        unrated = all_movie_set - pos_set
        if not unrated:
            continue

        unrated_arr = np.array(list(unrated))
        user_source = positive_df.loc[
            positive_df["global_user_id"] == uid, "source"
        ].iloc[0] if len(positive_df[positive_df["global_user_id"] == uid]) > 0 else "movielens"

        sampled_negatives: Set[int] = set()

        # 1. Random unrated
        _sample_into(sampled_negatives, unrated_arr, n_random, rng)

        # 2. Popular unrated
        pop_unrated_mask = np.isin(pop_movie_ids, list(unrated))
        pop_unrated = pop_movie_ids[pop_unrated_mask]
        pop_unrated_w = pop_weights[pop_unrated_mask]
        if len(pop_unrated) > 0 and pop_unrated_w.sum() > 0:
            pop_unrated_w = pop_unrated_w / pop_unrated_w.sum()
            n_pop_actual = min(n_popular, len(pop_unrated))
            chosen = rng.choice(pop_unrated, size=n_pop_actual, replace=False, p=pop_unrated_w)
            sampled_negatives.update(chosen)

        # 3. Genre-similar hard negatives
        user_genres = set()
        for mid in pos_set:
            for tok in movie_features.get(mid, []):
                if tok.startswith("genre:"):
                    user_genres.add(tok)
        genre_candidates = set()
        for g in user_genres:
            genre_candidates.update(genre_index.get(g, []))
        genre_candidates -= pos_set
        genre_candidates -= sampled_negatives
        if genre_candidates:
            genre_arr = np.array(list(genre_candidates))
            _sample_into(sampled_negatives, genre_arr, n_genre, rng)

        # 4. Language-similar hard negatives
        user_langs = set()
        for mid in pos_set:
            for tok in movie_features.get(mid, []):
                if tok.startswith("language:"):
                    user_langs.add(tok)
        lang_candidates = set()
        for l in user_langs:
            lang_candidates.update(language_index.get(l, []))
        lang_candidates -= pos_set
        lang_candidates -= sampled_negatives
        if lang_candidates:
            lang_arr = np.array(list(lang_candidates))
            _sample_into(sampled_negatives, lang_arr, n_language, rng)

        # 5. High-LightFM-score but unobserved
        if lightfm_scores and uid in lightfm_scores:
            user_lf = lightfm_scores[uid]
            lf_unrated = {
                mid: score for mid, score in user_lf.items()
                if mid in unrated and mid not in sampled_negatives
            }
            if lf_unrated:
                top_lf = sorted(lf_unrated.items(), key=lambda x: x[1], reverse=True)
                for mid, _ in top_lf[:n_lightfm]:
                    sampled_negatives.add(mid)

        # Build negative rows
        for mid in sampled_negatives:
            negative_rows.append({
                "global_user_id": uid,
                "global_movie_id": mid,
                "rating": 0.0,
                "relevance": 0,
                "source": user_source,
                "is_synthetic_negative": True,
            })

    neg_df = pd.DataFrame(negative_rows)
    logger.info(
        "Generated %d synthetic negatives for %d users (avg %.1f per user)",
        len(neg_df), len(users),
        len(neg_df) / max(len(users), 1),
    )
    return neg_df


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sample_into(
    target_set: Set[int],
    candidates: np.ndarray,
    n: int,
    rng: np.random.RandomState,
) -> None:
    """Sample up to n items from candidates into target_set."""
    available = np.setdiff1d(candidates, np.array(list(target_set)))
    if len(available) == 0:
        return
    k = min(n, len(available))
    chosen = rng.choice(available, size=k, replace=False)
    target_set.update(chosen.tolist())


def _build_feature_index(
    movie_features: Dict[int, List[str]],
    prefix: str,
) -> Dict[str, List[int]]:
    """
    Build inverted index: feature_token → list of movie IDs.
    """
    index: Dict[str, List[int]] = {}
    for mid, tokens in movie_features.items():
        for tok in tokens:
            if tok.startswith(prefix):
                index.setdefault(tok, []).append(mid)
    return index
