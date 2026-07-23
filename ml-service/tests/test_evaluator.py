"""Tests for evaluator.py — verify metric computations."""

import pytest
import numpy as np

from src.evaluator import (
    ndcg_at_k,
    precision_at_k,
    recall_at_k,
    hit_rate_at_k,
    average_precision,
    reciprocal_rank,
    catalog_coverage,
)


class TestNDCG:
    def test_perfect_ranking(self):
        rels = np.array([4, 3, 1, 0, 0])
        assert ndcg_at_k(rels, k=5) == pytest.approx(1.0, abs=1e-6)

    def test_worst_ranking(self):
        rels = np.array([0, 0, 0, 3, 4])
        assert ndcg_at_k(rels, k=5) < 1.0

    def test_empty(self):
        assert ndcg_at_k(np.array([]), k=10) == 0.0

    def test_all_zeros(self):
        assert ndcg_at_k(np.array([0, 0, 0]), k=3) == 0.0

    def test_single_relevant(self):
        rels = np.array([4])
        assert ndcg_at_k(rels, k=1) == pytest.approx(1.0, abs=1e-6)


class TestPrecision:
    def test_all_relevant(self):
        rels = np.array([4, 3, 2, 1, 1])
        assert precision_at_k(rels, k=5, threshold=1) == pytest.approx(1.0)

    def test_none_relevant(self):
        rels = np.array([0, 0, 0, 0, 0])
        assert precision_at_k(rels, k=5, threshold=1) == 0.0

    def test_half_relevant(self):
        rels = np.array([4, 0, 3, 0, 0])
        assert precision_at_k(rels, k=4, threshold=1) == pytest.approx(0.5)


class TestRecall:
    def test_all_found(self):
        rels = np.array([4, 3, 1])
        assert recall_at_k(rels, total_relevant=3, k=3, threshold=1) == pytest.approx(1.0)

    def test_partial(self):
        rels = np.array([4, 0, 0])
        assert recall_at_k(rels, total_relevant=2, k=3, threshold=1) == pytest.approx(0.5)

    def test_zero_relevant(self):
        rels = np.array([0, 0])
        assert recall_at_k(rels, total_relevant=0, k=2, threshold=1) == 0.0


class TestHitRate:
    def test_hit(self):
        rels = np.array([0, 0, 4, 0])
        assert hit_rate_at_k(rels, k=4, threshold=1) == 1.0

    def test_miss(self):
        rels = np.array([0, 0, 0, 0])
        assert hit_rate_at_k(rels, k=4, threshold=1) == 0.0


class TestAveragePrecision:
    def test_perfect(self):
        rels = np.array([1, 1, 1])
        assert average_precision(rels, k=3, threshold=1) == pytest.approx(1.0)

    def test_single_hit_at_k1(self):
        rels = np.array([1, 0, 0])
        assert average_precision(rels, k=3, threshold=1) == pytest.approx(1.0)

    def test_single_hit_at_k3(self):
        rels = np.array([0, 0, 1])
        # AP = (1/3) / 1 = 1/3
        assert average_precision(rels, k=3, threshold=1) == pytest.approx(1/3, abs=1e-6)


class TestReciprocalRank:
    def test_first_position(self):
        rels = np.array([4, 0, 0])
        assert reciprocal_rank(rels) == pytest.approx(1.0)

    def test_second_position(self):
        rels = np.array([0, 3, 0])
        assert reciprocal_rank(rels) == pytest.approx(0.5)

    def test_no_relevant(self):
        rels = np.array([0, 0, 0])
        assert reciprocal_rank(rels) == 0.0


class TestCatalogCoverage:
    def test_full_coverage(self):
        recommended = [{1, 2}, {3, 4}, {5}]
        assert catalog_coverage(recommended, total_items=5) == pytest.approx(1.0)

    def test_partial_coverage(self):
        recommended = [{1, 2}, {2, 3}]
        assert catalog_coverage(recommended, total_items=10) == pytest.approx(0.3)

    def test_empty(self):
        assert catalog_coverage([], total_items=10) == 0.0
        assert catalog_coverage([], total_items=0) == 0.0
