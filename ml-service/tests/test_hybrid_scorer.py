"""Tests for hybrid_scorer.py — verify blending formula and normalization."""

import pytest
import numpy as np

from src.hybrid_scorer import (
    normalize_scores,
    calculate_final_score,
    calculate_final_scores_batch,
)
from src import config


class TestNormalizeScores:
    def test_basic_normalization(self):
        scores = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        result = normalize_scores(scores)
        assert result[0] == pytest.approx(0.0, abs=1e-6)
        assert result[-1] == pytest.approx(1.0, abs=1e-6)

    def test_identical_scores_return_half(self):
        scores = np.array([3.0, 3.0, 3.0])
        result = normalize_scores(scores)
        assert all(r == pytest.approx(0.5, abs=1e-6) for r in result)

    def test_negative_scores(self):
        scores = np.array([-5.0, 0.0, 5.0])
        result = normalize_scores(scores)
        assert result[0] == pytest.approx(0.0, abs=1e-6)
        assert result[1] == pytest.approx(0.5, abs=1e-6)
        assert result[2] == pytest.approx(1.0, abs=1e-6)

    def test_single_element(self):
        result = normalize_scores(np.array([42.0]))
        assert result[0] == pytest.approx(0.5, abs=1e-6)


class TestCalculateFinalScore:
    def test_with_ranker_score(self):
        """Verify the exact 60/40 formula."""
        result = calculate_final_score(rule_score=0.8, ranker_score=0.6)
        expected = 0.60 * 0.8 + 0.40 * 0.6
        assert result == pytest.approx(expected, abs=1e-6)

    def test_without_ranker_score(self):
        """Without ML, should be 100% rule-based."""
        result = calculate_final_score(rule_score=0.8, ranker_score=None)
        assert result == pytest.approx(0.8, abs=1e-6)

    def test_zero_scores(self):
        result = calculate_final_score(0.0, 0.0)
        assert result == pytest.approx(0.0, abs=1e-6)

    def test_max_scores(self):
        result = calculate_final_score(1.0, 1.0)
        assert result == pytest.approx(1.0, abs=1e-6)


class TestCalculateFinalScoresBatch:
    def test_batch_matches_single(self):
        rule = np.array([0.8, 0.5, 0.3])
        ranker = np.array([0.6, 0.9, 0.1])

        batch = calculate_final_scores_batch(rule, ranker)

        for i in range(len(rule)):
            single = calculate_final_score(rule[i], ranker[i])
            assert batch[i] == pytest.approx(single, abs=1e-6)

    def test_batch_no_ranker(self):
        rule = np.array([0.8, 0.5])
        batch = calculate_final_scores_batch(rule, None)
        assert batch[0] == pytest.approx(0.8, abs=1e-6)
        assert batch[1] == pytest.approx(0.5, abs=1e-6)


class TestWeightsInvariant:
    def test_weights_are_60_40(self):
        assert config.RULE_WEIGHT == pytest.approx(0.60)
        assert config.MODEL_WEIGHT == pytest.approx(0.40)

    def test_score_ordering_preserved(self):
        """Higher rule + ranker should yield higher final score."""
        high = calculate_final_score(0.9, 0.9)
        low = calculate_final_score(0.1, 0.1)
        assert high > low
