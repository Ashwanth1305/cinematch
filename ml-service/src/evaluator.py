"""
CineMatch ML Engine — Evaluator

Compares four ranking systems:
  1. Rule-based only
  2. LightFM only
  3. XGBRanker only
  4. 60 % rule + 40 % XGBRanker  (hybrid)

Metrics reported per system:
  NDCG@10, Precision@10, Recall@10, Hit Rate@10, MAP@10, MRR,
  Catalog coverage.

Results are segmented by:
  All users, MovieLens users, Indian users,
  Indian movies, Warm items, Cold-item simulation.
"""

import logging
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from . import config
from .model_store import save_evaluation

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Metric computation
# ---------------------------------------------------------------------------

def ndcg_at_k(relevances: np.ndarray, k: int = 10) -> float:
    """Compute NDCG@k for a single ranked list."""
    relevances = np.asarray(relevances)[:k]
    if len(relevances) == 0 or relevances.max() == 0:
        return 0.0
    dcg = np.sum(relevances / np.log2(np.arange(2, len(relevances) + 2)))
    ideal = np.sort(relevances)[::-1]
    idcg = np.sum(ideal / np.log2(np.arange(2, len(ideal) + 2)))
    return float(dcg / idcg) if idcg > 0 else 0.0


def precision_at_k(relevances: np.ndarray, k: int = 10, threshold: int = 1) -> float:
    """Fraction of top-k items that are relevant (relevance >= threshold)."""
    relevances = np.asarray(relevances)[:k]
    if len(relevances) == 0:
        return 0.0
    return float(np.sum(relevances >= threshold) / k)


def recall_at_k(
    relevances: np.ndarray,
    total_relevant: int,
    k: int = 10,
    threshold: int = 1,
) -> float:
    """Fraction of all relevant items found in top-k."""
    relevances = np.asarray(relevances)[:k]
    if total_relevant == 0:
        return 0.0
    return float(np.sum(relevances >= threshold) / total_relevant)


def hit_rate_at_k(relevances: np.ndarray, k: int = 10, threshold: int = 1) -> float:
    """1 if at least one relevant item in top-k, else 0."""
    relevances = np.asarray(relevances)[:k]
    return 1.0 if np.any(relevances >= threshold) else 0.0


def average_precision(relevances: np.ndarray, k: int = 10, threshold: int = 1) -> float:
    """Average Precision for a ranked list."""
    relevances = np.asarray(relevances)[:k]
    if len(relevances) == 0:
        return 0.0
    hits = 0
    sum_precision = 0.0
    for i, rel in enumerate(relevances):
        if rel >= threshold:
            hits += 1
            sum_precision += hits / (i + 1)
    return sum_precision / max(np.sum(relevances >= threshold), 1)


def reciprocal_rank(relevances: np.ndarray, threshold: int = 1) -> float:
    """Reciprocal of the rank of the first relevant item."""
    for i, rel in enumerate(np.asarray(relevances)):
        if rel >= threshold:
            return 1.0 / (i + 1)
    return 0.0


def catalog_coverage(
    recommended_items: List[set],
    total_items: int,
) -> float:
    """Fraction of catalog items that appeared in any recommendation."""
    if total_items == 0:
        return 0.0
    all_recommended = set()
    for items in recommended_items:
        all_recommended.update(items)
    return len(all_recommended) / total_items


# ---------------------------------------------------------------------------
# Per-user evaluation
# ---------------------------------------------------------------------------

def evaluate_ranking(
    test_df: pd.DataFrame,
    score_column: str,
    k: int = 10,
    relevance_threshold: int = 1,
) -> Dict[str, float]:
    """
    Evaluate a single ranking system on test data.

    Parameters
    ----------
    test_df : pd.DataFrame
        Must have: global_user_id, global_movie_id, relevance, <score_column>.
    score_column : str
        Column containing the system's predicted score.
    k : int
        Evaluation cutoff.
    relevance_threshold : int
        Minimum relevance to count as "relevant".

    Returns
    -------
    dict of metric name → average value.
    """
    metrics = {
        "ndcg@10": [],
        "precision@10": [],
        "recall@10": [],
        "hit_rate@10": [],
        "map@10": [],
        "mrr": [],
    }
    all_recommended: List[set] = []
    total_items = test_df["global_movie_id"].nunique()

    for uid, group in test_df.groupby("global_user_id"):
        # Sort by predicted score descending
        sorted_group = group.sort_values(score_column, ascending=False)
        rels = sorted_group["relevance"].values

        total_relevant = int(np.sum(rels >= relevance_threshold))

        metrics["ndcg@10"].append(ndcg_at_k(rels, k))
        metrics["precision@10"].append(precision_at_k(rels, k, relevance_threshold))
        metrics["recall@10"].append(recall_at_k(rels, total_relevant, k, relevance_threshold))
        metrics["hit_rate@10"].append(hit_rate_at_k(rels, k, relevance_threshold))
        metrics["map@10"].append(average_precision(rels, k, relevance_threshold))
        metrics["mrr"].append(reciprocal_rank(rels, relevance_threshold))

        top_items = set(sorted_group["global_movie_id"].values[:k])
        all_recommended.append(top_items)

    result = {name: float(np.mean(vals)) for name, vals in metrics.items()}
    result["catalog_coverage"] = catalog_coverage(all_recommended, total_items)
    result["n_users_evaluated"] = len(test_df["global_user_id"].unique())

    return result


# ---------------------------------------------------------------------------
# Segmented evaluation
# ---------------------------------------------------------------------------

def evaluate_segments(
    test_df: pd.DataFrame,
    score_column: str,
    movies_df: pd.DataFrame,
    movie_feature_tokens: Dict[int, List[str]],
    k: int = 10,
) -> Dict[str, Dict[str, float]]:
    """
    Evaluate across multiple segments:
    - all_users
    - movielens_users
    - indian_users
    - indian_movies
    - warm_items  (>= 5 interactions)
    - cold_items  (< 5 interactions)
    """
    results = {}

    # All users
    results["all_users"] = evaluate_ranking(test_df, score_column, k)

    # By source
    if "source" in test_df.columns:
        ml_mask = test_df["source"] != "indian_regional"
        if ml_mask.any():
            results["movielens_users"] = evaluate_ranking(
                test_df[ml_mask], score_column, k
            )

        in_mask = test_df["source"] == "indian_regional"
        if in_mask.any():
            results["indian_users"] = evaluate_ranking(
                test_df[in_mask], score_column, k
            )

    # Indian movies
    indian_movie_ids = set()
    for mid, tokens in movie_feature_tokens.items():
        for t in tokens:
            if t in ("source:indian_regional", "language:hindi", "language:tamil",
                      "language:telugu", "language:malayalam"):
                indian_movie_ids.add(mid)
                break

    if indian_movie_ids:
        in_movie_mask = test_df["global_movie_id"].isin(indian_movie_ids)
        if in_movie_mask.any():
            results["indian_movies"] = evaluate_ranking(
                test_df[in_movie_mask], score_column, k
            )

    # Warm vs cold items
    item_counts = test_df.groupby("global_movie_id").size()
    warm_items = set(item_counts[item_counts >= 5].index)
    cold_items = set(item_counts[item_counts < 5].index)

    if warm_items:
        warm_mask = test_df["global_movie_id"].isin(warm_items)
        if warm_mask.any():
            results["warm_items"] = evaluate_ranking(
                test_df[warm_mask], score_column, k
            )

    if cold_items:
        cold_mask = test_df["global_movie_id"].isin(cold_items)
        if cold_mask.any():
            results["cold_items"] = evaluate_ranking(
                test_df[cold_mask], score_column, k
            )

    return results


# ---------------------------------------------------------------------------
# Full comparison of four systems
# ---------------------------------------------------------------------------

def compare_all_systems(
    test_df: pd.DataFrame,
    movies_df: pd.DataFrame,
    movie_feature_tokens: Dict[int, List[str]],
    k: int = 10,
) -> Dict:
    """
    Compare the four ranking systems.

    test_df must have columns:
      - rule_based_score
      - lightfm_score
      - xgb_ranker_score
      - hybrid_score  (0.6*rule + 0.4*xgb)
      - relevance
      - global_user_id, global_movie_id, source

    Returns a nested dict: {system_name: {segment: {metric: value}}}.
    """
    systems = {
        "rule_based_only": "rule_based_score",
        "lightfm_only": "lightfm_score",
        "xgb_ranker_only": "xgb_ranker_score",
        "hybrid_60_40": "hybrid_score",
    }

    comparison = {}
    score_columns = [col for col in systems.values() if col in test_df.columns]
    for i, left in enumerate(score_columns):
        for right in score_columns[i + 1:]:
            if np.allclose(
                test_df[left].to_numpy(dtype=float),
                test_df[right].to_numpy(dtype=float),
                equal_nan=True,
            ):
                logger.warning(
                    "Evaluation score columns '%s' and '%s' are identical; "
                    "their metric comparison is not independent.", left, right
                )

    for system_name, col in systems.items():
        if col not in test_df.columns:
            logger.warning("Score column '%s' missing — skipping %s", col, system_name)
            continue

        logger.info("Evaluating system: %s (column: %s)", system_name, col)
        comparison[system_name] = evaluate_segments(
            test_df, col, movies_df, movie_feature_tokens, k
        )

    return comparison


def run_full_evaluation(
    test_df: pd.DataFrame,
    movies_df: pd.DataFrame,
    movie_feature_tokens: Dict[int, List[str]],
    k: int = 10,
) -> None:
    """
    Run full evaluation and save all result files.
    """
    comparison = compare_all_systems(test_df, movies_df, movie_feature_tokens, k)

    # Save comparison
    save_evaluation(comparison, "model_comparison")

    # Save individual evaluations
    if "lightfm_only" in comparison:
        save_evaluation(comparison["lightfm_only"], "lightfm_evaluation")

    if "xgb_ranker_only" in comparison:
        save_evaluation(comparison["xgb_ranker_only"], "xgb_evaluation")

    # Log summary
    logger.info("\n" + "=" * 70)
    logger.info("EVALUATION SUMMARY")
    logger.info("=" * 70)
    for system, segments in comparison.items():
        if "all_users" in segments:
            m = segments["all_users"]
            logger.info(
                "%-20s  NDCG@10=%.4f  P@10=%.4f  HR@10=%.4f  MRR=%.4f",
                system,
                m.get("ndcg@10", 0),
                m.get("precision@10", 0),
                m.get("hit_rate@10", 0),
                m.get("mrr", 0),
            )
    logger.info("=" * 70)
