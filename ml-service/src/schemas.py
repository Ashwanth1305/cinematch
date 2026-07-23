"""
CineMatch ML Engine — Pydantic Schemas

Request and response models for the FastAPI service.
"""

from typing import Dict, List, Optional, Union

UserId = Union[int, str]

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Recommendation endpoint
# ---------------------------------------------------------------------------

class CandidateInput(BaseModel):
    """A single movie candidate with pre-computed feature scores."""
    movie_id: int
    rule_score: float = Field(ge=0.0, le=1.5, description="Rule-based recommendation score")
    genre_affinity_score: float = Field(default=0.5, ge=0.0, le=1.0)
    language_match_score: float = Field(default=0.5, ge=0.0, le=1.0)
    actor_match_score: float = Field(default=0.0, ge=0.0, le=1.0)
    director_match_score: float = Field(default=0.0, ge=0.0, le=1.0)
    keyword_similarity_score: float = Field(default=0.0, ge=0.0, le=1.0)
    tmdb_rating: float = Field(default=5.0, ge=0.0, le=10.0)
    tmdb_popularity: float = Field(default=50.0, ge=0.0)
    release_year: int = Field(default=2020, ge=1900, le=2030)
    source_dataset: int = Field(default=0, description="0=movielens, 1=indian_regional")
    is_indian_content: int = Field(default=0, description="Binary flag")
    is_cold_start_movie: int = Field(default=0, description="Binary flag")


class RecommendationRequest(BaseModel):
    """Request body for /recommendations endpoint."""
    user_id: UserId
    candidates: List[CandidateInput]
    top_k: int = Field(default=20, ge=1, le=500)


class RecommendationResult(BaseModel):
    """A single ranked result."""
    movie_id: int
    lightfm_score: Optional[float] = None
    ranker_score: Optional[float] = None
    rule_score: float
    final_score: float


class RecommendationResponse(BaseModel):
    """Response body for /recommendations endpoint."""
    user_id: UserId
    recommendations: List[RecommendationResult]
    model_available: bool = True
    fallback_used: bool = False


# ---------------------------------------------------------------------------
# Hybrid score endpoint
# ---------------------------------------------------------------------------

class HybridScoreRequest(BaseModel):
    """Request body for /hybrid-score endpoint."""
    user_id: UserId
    movie_id: int
    rule_score: float
    genre_affinity_score: float = 0.5
    language_match_score: float = 0.5
    actor_match_score: float = 0.0
    director_match_score: float = 0.0
    keyword_similarity_score: float = 0.0
    tmdb_rating: float = 5.0
    tmdb_popularity: float = 50.0
    release_year: int = 2020


class HybridScoreResponse(BaseModel):
    """Response body for /hybrid-score endpoint."""
    movie_id: int
    user_id: UserId
    lightfm_score: Optional[float] = None
    raw_xgb_score: Optional[float] = None
    normalized_xgb_score: Optional[float] = None
    rule_score: float
    final_score: float


# ---------------------------------------------------------------------------
# Health / Info endpoints
# ---------------------------------------------------------------------------

class HealthResponse(BaseModel):
    """Response for /health endpoint."""
    status: str = "ok"
    lightfm_loaded: bool = False
    xgb_loaded: bool = False


class ModelInfoResponse(BaseModel):
    """Response for /model-info endpoint."""
    lightfm_available: bool = False
    xgb_available: bool = False
    model_metadata: Optional[Dict] = None
    xgb_feature_columns: Optional[List[str]] = None
    hybrid_weights: Dict[str, float] = {
        "rule_weight": 0.60,
        "model_weight": 0.40,
    }
