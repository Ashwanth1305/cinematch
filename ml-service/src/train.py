"""
CineMatch ML Engine — Training Orchestrator

Runs the full training pipeline end-to-end:

 1. Validate data files exist
 2. Load all rating chunks + movie/user metadata
 3. Normalize relevance labels
 4. Build user & movie metadata features
 5. Per-user train/val/test split
 6. Train LightFM (WARP loss, 64 components)
 7. Generate LightFM scores for ranking samples
 8. Create synthetic negatives
 9. Build XGBRanker feature table
10. Train XGBRanker (rank:ndcg)
11. Evaluate all 4 approaches
12. Save models and metadata

Usage:
    cd ml-service
    python -m src.train
"""

import json
import logging
import sys
import time
from datetime import datetime

import numpy as np
import pandas as pd

from . import config
from .data_loader import validate_data_files, load_all
from .preprocessing import (
    add_relevance_labels,
    build_id_mappings,
    save_mappings,
    extract_positive_interactions,
    compute_interaction_weights,
    per_user_split,
)
from .feature_builder import (
    build_movie_feature_tokens,
    build_user_feature_tokens,
    compute_movie_stats,
    compute_user_stats,
)
from .lightfm_trainer import LIGHTFM_AVAILABLE
if LIGHTFM_AVAILABLE:
    from .lightfm_trainer import (
        build_lightfm_dataset,
        build_interactions,
        build_feature_matrices,
        train_lightfm,
        score_candidates,
        save_lightfm_artifacts,
    )
from .negative_sampler import sample_negatives
from .ranker_dataset import build_ranker_dataset
from .xgb_trainer import train_xgb_ranker, save_xgb_ranker
from .evaluator import run_full_evaluation
from .hybrid_scorer import normalize_scores, calculate_final_score
from .model_store import save_model_metadata, save_feature_columns

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(config.ARTIFACTS_DIR / "training.log", mode="w"),
    ],
)
logger = logging.getLogger("train")


def _score_candidate_pairs(model, dataset, pairs, user_features, item_features):
    """Score only requested user/movie pairs instead of the full catalog."""
    scores_by_user = {}
    grouped = pairs.drop_duplicates(["global_user_id", "global_movie_id"]).groupby(
        "global_user_id", sort=False
    )
    total_users = grouped.ngroups
    for index, (uid, group) in enumerate(grouped, start=1):
        movie_ids = group["global_movie_id"].tolist()
        predictions = score_candidates(
            model, dataset, uid, movie_ids, user_features, item_features
        )
        scores_by_user[uid] = dict(zip(movie_ids, map(float, predictions)))
        if index % 5000 == 0:
            logger.info("    Scored candidate pairs for %d / %d users", index, total_users)
    return scores_by_user


def main():
    t0 = time.time()
    logger.info("=" * 70)
    logger.info("CineMatch ML Training Pipeline")
    logger.info("=" * 70)

    # -----------------------------------------------------------------------
    # 1. Validate data files
    # -----------------------------------------------------------------------
    logger.info("\n📂 Step 1/12: Validating data files …")
    if not validate_data_files():
        logger.error("❌ Missing data files — cannot proceed.")
        sys.exit(1)
    logger.info("✓ All data files present")

    # -----------------------------------------------------------------------
    # 2. Load all data
    # -----------------------------------------------------------------------
    logger.info("\n📥 Step 2/12: Loading data …")
    ratings, movies, users = load_all()

    logger.info("  Ratings: %d rows", len(ratings))
    logger.info("  Movies:  %d rows", len(movies))
    logger.info("  Users:   %d rows", len(users))

    # -----------------------------------------------------------------------
    # 3. Normalize relevance labels
    # -----------------------------------------------------------------------
    logger.info("\n🏷️  Step 3/12: Adding relevance labels …")
    ratings = add_relevance_labels(ratings)

    # -----------------------------------------------------------------------
    # 4. Build feature tokens
    # -----------------------------------------------------------------------
    logger.info("\n🔧 Step 4/12: Building feature tokens …")
    movie_feature_tokens, movie_vocab = build_movie_feature_tokens(movies)
    user_feature_tokens, user_vocab = build_user_feature_tokens(users)

    logger.info("  Movie feature vocab: %d tokens", len(movie_vocab))
    logger.info("  User feature vocab:  %d tokens", len(user_vocab))

    # -----------------------------------------------------------------------
    # 5. Per-user train/val/test split
    # -----------------------------------------------------------------------
    logger.info("\n✂️  Step 5/12: Splitting data per user …")
    train_df, val_df, test_df = per_user_split(ratings)

    # -----------------------------------------------------------------------
    # 6. Train LightFM (optional — requires lightfm package)
    # -----------------------------------------------------------------------
    # Build ID mappings from training data
    user_to_idx, idx_to_user, movie_to_idx, idx_to_movie = build_id_mappings(train_df)
    save_mappings(user_to_idx, idx_to_user, movie_to_idx, idx_to_movie)

    # Extract positive interactions
    train_positives = extract_positive_interactions(train_df)
    interaction_weights = compute_interaction_weights(train_positives)

    all_user_ids = sorted(ratings["global_user_id"].unique())
    all_movie_ids = sorted(ratings["global_movie_id"].unique())

    lightfm_scores = {}
    lfm_cfg = config.LightFMConfig()

    # Sample users for training (cap at 50k for memory)
    train_user_ids = train_df["global_user_id"].unique()
    sample_size = min(len(train_user_ids), 50000)
    rng = np.random.RandomState(42)
    sampled_users = rng.choice(train_user_ids, size=sample_size, replace=False)

    if LIGHTFM_AVAILABLE:
        logger.info("\n🧠 Step 6/12: Training LightFM …")

        lfm_dataset = build_lightfm_dataset(
            all_user_ids=all_user_ids,
            all_movie_ids=all_movie_ids,
            user_feature_vocab=user_vocab,
            item_feature_vocab=movie_vocab,
        )

        interactions, int_weights = build_interactions(
            lfm_dataset, train_positives, interaction_weights,
        )
        user_features, item_features = build_feature_matrices(
            lfm_dataset, user_feature_tokens, movie_feature_tokens,
        )

        lightfm_model = train_lightfm(
            interactions, int_weights, user_features, item_features, lfm_cfg,
        )

        save_lightfm_artifacts(lightfm_model, lfm_dataset, user_features, item_features)
        logger.info("✓ LightFM training complete")

        # -------------------------------------------------------------------
        # 7. Generate LightFM scores for ranking samples
        # -------------------------------------------------------------------
        logger.info("\n📊 Step 7/12: Generating LightFM scores …")

        logger.info("  Deferring scoring until exact ranker candidate pairs are known")
    else:
        logger.info("\n⏭️  Steps 6-7/12: Skipping LightFM (not installed)")
        logger.info("  XGBRanker will train without LightFM score features")

    # -----------------------------------------------------------------------
    # 8. Create synthetic negatives
    # -----------------------------------------------------------------------
    logger.info("\n➖ Step 8/12: Sampling negatives …")

    # Movie popularity (interaction counts)
    movie_pop = (
        train_df.groupby("global_movie_id").size()
        .to_dict()
    )

    # Use only sampled users for negative generation to keep memory manageable
    train_sampled = train_df[train_df["global_user_id"].isin(sampled_users)]
    train_sampled_positives = extract_positive_interactions(train_sampled)

    neg_df = sample_negatives(
        positive_df=train_sampled_positives,
        all_movie_ids=np.array(all_movie_ids),
        movie_features=movie_feature_tokens,
        movie_popularity=movie_pop,
        lightfm_scores=lightfm_scores,
        negative_ratio=config.NEGATIVE_RATIO,
    )
    logger.info("✓ Generated %d synthetic negatives", len(neg_df))

    # Combine positives + negatives for ranker training
    train_sampled_positives["is_synthetic_negative"] = False
    combined_train = pd.concat(
        [train_sampled_positives, neg_df], ignore_index=True,
    )

    if LIGHTFM_AVAILABLE:
        logger.info("Scoring only train/validation/test candidate pairs …")
        sampled_pair_frames = [
            combined_train[["global_user_id", "global_movie_id"]],
            val_df[val_df["global_user_id"].isin(sampled_users)][["global_user_id", "global_movie_id"]],
            test_df[test_df["global_user_id"].isin(sampled_users)][["global_user_id", "global_movie_id"]],
        ]
        candidate_pairs = pd.concat(sampled_pair_frames, ignore_index=True)
        lightfm_scores = _score_candidate_pairs(
            lightfm_model, lfm_dataset, candidate_pairs, user_features, item_features
        )
        del candidate_pairs, sampled_pair_frames
        logger.info("✓ LightFM candidate scores generated for %d users", len(lightfm_scores))

    # -----------------------------------------------------------------------
    # 9. Build XGBRanker feature table
    # -----------------------------------------------------------------------
    logger.info("\n📋 Step 9/12: Building ranker feature table …")

    feature_df, train_group_sizes, feature_columns = build_ranker_dataset(
        ratings_with_negatives=combined_train,
        movies_df=movies,
        users_df=users,
        all_ratings=train_df,
        movie_feature_tokens=movie_feature_tokens,
        user_feature_tokens=user_feature_tokens,
        lightfm_scores=lightfm_scores,
    )

    X_train = feature_df[feature_columns].values.astype(np.float32)
    y_train = feature_df["relevance"].values.astype(np.float32)

    logger.info("  X_train shape: %s, groups: %d", X_train.shape, len(train_group_sizes))

    # --- Build validation set -----------------------------------------------
    # Use val_df users that overlap with sampled users
    val_sampled = val_df[val_df["global_user_id"].isin(sampled_users)]
    if len(val_sampled) > 0:
        val_sampled = add_relevance_labels(val_sampled)
        val_sampled["is_synthetic_negative"] = False

        val_feature_df, val_group_sizes, _ = build_ranker_dataset(
            ratings_with_negatives=val_sampled,
            movies_df=movies,
            users_df=users,
            all_ratings=train_df,
            movie_feature_tokens=movie_feature_tokens,
            user_feature_tokens=user_feature_tokens,
            lightfm_scores=lightfm_scores,
        )
        X_val = val_feature_df[feature_columns].values.astype(np.float32)
        y_val = val_feature_df["relevance"].values.astype(np.float32)
        logger.info("  X_val shape: %s, groups: %d", X_val.shape, len(val_group_sizes))
    else:
        X_val = y_val = val_group_sizes = None
        logger.warning("  No validation data available — skipping early stopping")

    # -----------------------------------------------------------------------
    # 10. Train XGBRanker
    # -----------------------------------------------------------------------
    logger.info("\n🌲 Step 10/12: Training XGBRanker …")

    xgb_cfg = config.XGBRankerConfig()
    ranker = train_xgb_ranker(
        X_train=X_train,
        y_train=y_train,
        train_group_sizes=train_group_sizes,
        X_val=X_val,
        y_val=y_val,
        val_group_sizes=val_group_sizes,
        feature_columns=feature_columns,
        cfg=xgb_cfg,
    )
    save_xgb_ranker(ranker)
    logger.info("✓ XGBRanker training complete")

    # -----------------------------------------------------------------------
    # 11. Evaluate all 4 approaches
    # -----------------------------------------------------------------------
    logger.info("\n📈 Step 11/12: Evaluating …")

    # Build test evaluation set
    test_sampled = test_df[test_df["global_user_id"].isin(sampled_users)]
    if len(test_sampled) > 0:
        test_sampled = add_relevance_labels(test_sampled)
        test_sampled["is_synthetic_negative"] = False

        test_feature_df, test_group_sizes, _ = build_ranker_dataset(
            ratings_with_negatives=test_sampled,
            movies_df=movies,
            users_df=users,
            all_ratings=train_df,
            movie_feature_tokens=movie_feature_tokens,
            user_feature_tokens=user_feature_tokens,
            lightfm_scores=lightfm_scores,
        )

        # Add XGBRanker predictions
        X_test = test_feature_df[feature_columns].values.astype(np.float32)
        test_feature_df["xgb_ranker_score"] = ranker.predict(X_test)

        # Add hybrid score
        rule_scores = test_feature_df["rule_based_score"].values
        # Ranking scores must be normalized within each user's candidate set.
        # Global normalization lets cross-user score ranges distort the blend.
        xgb_scores = test_feature_df.groupby("global_user_id")["xgb_ranker_score"].transform(
            lambda scores: normalize_scores(scores.to_numpy())
        ).to_numpy()
        test_feature_df["hybrid_score"] = np.array([
            calculate_final_score(r, x) for r, x in zip(rule_scores, xgb_scores)
        ])

        # Run full comparison
        run_full_evaluation(
            test_df=test_feature_df,
            movies_df=movies,
            movie_feature_tokens=movie_feature_tokens,
        )
    else:
        logger.warning("  No test data available for evaluation")

    # -----------------------------------------------------------------------
    # 12. Save metadata
    # -----------------------------------------------------------------------
    logger.info("\n💾 Step 12/12: Saving metadata …")

    elapsed = time.time() - t0
    metadata = {
        "trained_at": datetime.now().isoformat(),
        "training_duration_seconds": round(elapsed, 1),
        "dataset": {
            "total_ratings": len(ratings),
            "total_movies": len(movies),
            "total_users": len(users),
            "sampled_users_for_training": int(sample_size),
            "train_rows": len(train_df),
            "val_rows": len(val_df),
            "test_rows": len(test_df),
        },
        "lightfm": {
            "loss": lfm_cfg.loss,
            "no_components": lfm_cfg.no_components,
            "epochs": lfm_cfg.epochs,
            "learning_rate": lfm_cfg.learning_rate,
        },
        "xgb_ranker": {
            "objective": xgb_cfg.objective,
            "n_estimators": xgb_cfg.n_estimators,
            "max_depth": xgb_cfg.max_depth,
            "n_features": len(feature_columns),
            "feature_columns": feature_columns,
        },
        "hybrid_weights": {
            "rule_weight": config.RULE_WEIGHT,
            "model_weight": config.MODEL_WEIGHT,
        },
        "negative_sampling": {
            "ratio": config.NEGATIVE_RATIO,
            "total_negatives": len(neg_df),
        },
    }
    save_model_metadata(metadata)

    logger.info("\n" + "=" * 70)
    logger.info("✅ Training complete in %.1f minutes", elapsed / 60)
    logger.info("   Artifacts saved to: %s", config.ARTIFACTS_DIR)
    logger.info("=" * 70)


if __name__ == "__main__":
    main()
