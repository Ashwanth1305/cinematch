"""Tests for preprocessing.py — verify label mapping, splits, and weights."""

import pytest
import numpy as np
import pandas as pd

from src import config
from src.preprocessing import (
    add_relevance_labels,
    build_id_mappings,
    extract_positive_interactions,
    compute_interaction_weights,
    per_user_split,
)


@pytest.fixture
def sample_ratings():
    """Create a small ratings DataFrame matching the actual schema."""
    return pd.DataFrame({
        "global_user_id": [1, 1, 1, 2, 2, 2, 3, 3],
        "global_movie_id": [10, 20, 30, 10, 40, 50, 20, 30],
        "normalized_rating": [0.7, 0.9, 0.4, 0.8, 0.3, 0.6, 1.0, 0.2],
        "source_rating": [3.5, 4.5, 2.0, 4.0, 1, 0, 1, -1],
        "source_dataset": [
            "movielens", "movielens", "movielens",
            "movielens", "indian_regional", "indian_regional",
            "indian_regional", "indian_regional",
        ],
        "source": [
            "movielens", "movielens", "movielens",
            "movielens", "indian_regional", "indian_regional",
            "indian_regional", "indian_regional",
        ],
        "preference_label": [
            "neutral", "like", "dislike",
            "like", "like", "neutral",
            "like", "dislike",
        ],
        "rating": [3.5, 4.5, 2.0, 4.0, 1, 0, 1, -1],
        "timestamp": [
            "2020-01-01", "2020-02-01", "2020-03-01",
            "2020-01-01", "2020-02-01", "2020-03-01",
            "2020-01-01", "2020-02-01",
        ],
    })


def test_add_relevance_labels(sample_ratings):
    """Test relevance label assignment using preference_label."""
    result = add_relevance_labels(sample_ratings)
    assert "relevance" in result.columns
    # "like" → 4, "neutral" → 1, "dislike" → 0
    assert result.iloc[0]["relevance"] == 1  # neutral
    assert result.iloc[1]["relevance"] == 4  # like
    assert result.iloc[2]["relevance"] == 0  # dislike


def test_build_id_mappings(sample_ratings):
    """Test that ID mappings are compact and reversible."""
    u2i, i2u, m2i, i2m = build_id_mappings(sample_ratings)

    # Check all users/movies mapped
    assert len(u2i) == 3  # users 1, 2, 3
    assert len(m2i) == 5  # movies 10, 20, 30, 40, 50

    # Check reversibility
    for uid, idx in u2i.items():
        assert i2u[idx] == uid
    for mid, idx in m2i.items():
        assert i2m[idx] == mid

    # Check 0-based
    assert set(u2i.values()) == {0, 1, 2}


def test_extract_positive_interactions(sample_ratings):
    """Test positive extraction uses preference_label='like'."""
    positives = extract_positive_interactions(sample_ratings)
    # Likes: row 1 (ml 4.5), row 3 (ml 4.0), row 4 (indian 1), row 6 (indian 1)
    assert len(positives) == 4
    assert all(positives["preference_label"].str.lower() == "like")


def test_compute_interaction_weights(sample_ratings):
    """Test that Indian weights are higher than MovieLens."""
    weights = compute_interaction_weights(sample_ratings)
    assert len(weights) == len(sample_ratings)
    assert all(weights > 0)

    # Indian weights should be config.SOURCE_WEIGHTS["indian_regional"]
    indian_mask = sample_ratings["source"] == "indian_regional"
    indian_weights = weights[indian_mask.values]
    assert all(w == config.SOURCE_WEIGHTS["indian_regional"] for w in indian_weights)


def test_per_user_split(sample_ratings):
    """Test that split preserves all rows and users."""
    train, val, test = per_user_split(sample_ratings)

    total = len(train) + len(val) + len(test)
    assert total == len(sample_ratings)

    # Each user should appear in at least the training set
    train_users = set(train["global_user_id"].unique())
    all_users = set(sample_ratings["global_user_id"].unique())
    assert train_users == all_users


def test_per_user_split_minimum_train(sample_ratings):
    """Even users with 1 interaction should get at least 1 train sample."""
    single_user = pd.DataFrame({
        "global_user_id": [99],
        "global_movie_id": [100],
        "source_dataset": ["movielens"],
        "source": ["movielens"],
        "rating": [4.0],
        "source_rating": [4.0],
        "normalized_rating": [0.8],
        "timestamp": ["2020-01-01"],
    })
    train, val, test = per_user_split(single_user)
    assert len(train) == 1
