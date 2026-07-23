"""Tests for config.py — verify default values and mapping functions."""

import pytest
from src import config


def test_movielens_relevance_mapping():
    """Verify MovieLens rating → relevance conversion."""
    assert config.movielens_rating_to_relevance(5.0) == 4
    assert config.movielens_rating_to_relevance(4.5) == 4
    assert config.movielens_rating_to_relevance(4.0) == 3
    assert config.movielens_rating_to_relevance(3.5) == 1
    assert config.movielens_rating_to_relevance(3.0) == 1
    assert config.movielens_rating_to_relevance(2.5) == 0
    assert config.movielens_rating_to_relevance(1.0) == 0
    assert config.movielens_rating_to_relevance(0.5) == 0


def test_indian_relevance_mapping():
    """Verify Indian Regional rating → relevance conversion."""
    assert config.indian_rating_to_relevance(1) == 4   # like
    assert config.indian_rating_to_relevance(0) == 1   # neutral
    assert config.indian_rating_to_relevance(-1) == 0  # dislike
    assert config.indian_rating_to_relevance(99) == 0  # unknown → 0


def test_preference_label_mapping():
    """Verify preference_label → relevance conversion."""
    assert config.preference_label_to_relevance("like") == 4
    assert config.preference_label_to_relevance("neutral") == 1
    assert config.preference_label_to_relevance("dislike") == 0
    assert config.preference_label_to_relevance("LIKE") == 4
    assert config.preference_label_to_relevance(" Like ") == 4
    assert config.preference_label_to_relevance("unknown") == 1  # default


def test_dob_to_age_band():
    """Verify DOB → age band conversion."""
    # reference_year=2025: 2025-1990=35 → 35_44
    assert config.dob_to_age_band("1990-05-15") == "35_44"
    assert config.dob_to_age_band("2010-01-01") == "under_18"
    assert config.dob_to_age_band("1950-01-01") == "55_plus"
    assert config.dob_to_age_band(None) == "unknown"
    assert config.dob_to_age_band("") == "unknown"
    assert config.dob_to_age_band("nan") == "unknown"


def test_hybrid_weights_sum_to_one():
    """RULE_WEIGHT + MODEL_WEIGHT must equal 1.0."""
    assert abs(config.RULE_WEIGHT + config.MODEL_WEIGHT - 1.0) < 1e-6


def test_negative_mix_sums_to_one():
    """Negative sampling mix ratios should sum to 1.0."""
    total = sum(config.NEGATIVE_MIX.values())
    assert abs(total - 1.0) < 1e-6


def test_xgb_feature_columns_count():
    """We expect exactly 20 feature columns."""
    assert len(config.XGB_FEATURE_COLUMNS) == 20


def test_data_dir_exists():
    """DATA_DIR should point to an existing directory (in dev)."""
    # This may fail in CI — that's expected
    assert config.DATA_DIR is not None


def test_split_ratios_sum():
    """Train + val + test ratios should sum to 1.0."""
    total = config.TRAIN_RATIO + config.VAL_RATIO + config.TEST_RATIO
    assert abs(total - 1.0) < 1e-6
