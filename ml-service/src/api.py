"""
CineMatch ML Engine — FastAPI Service

Endpoints:
  GET  /health           — Service health check
  GET  /model-info       — Model metadata & training metrics
  POST /recommendations  — Rank candidates for a user
  POST /hybrid-score     — Score a single user–movie pair
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .model_store import get_bundle, has_lightfm, has_xgb_ranker
from .recommender import recommend, compute_hybrid_score
from .schemas import (
    CandidateInput,
    RecommendationRequest,
    RecommendationResponse,
    RecommendationResult,
    HybridScoreRequest,
    HybridScoreResponse,
    HealthResponse,
    ModelInfoResponse,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan: load models on startup
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model artifacts on startup."""
    logger.info("Loading model artifacts …")
    try:
        bundle = get_bundle()
        logger.info(
            "Models loaded — LightFM: %s, XGBRanker: %s",
            "✓" if has_lightfm() else "✗",
            "✓" if has_xgb_ranker() else "✗",
        )
    except Exception as e:
        logger.warning("Model loading failed: %s — running in fallback mode", e)
    yield


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="CineMatch ML Recommendation Service",
    description=(
        "Two-stage recommendation engine: "
        "LightFM candidate generation → XGBRanker re-ranking → "
        "60 %% rule-based + 40 %% ML hybrid scoring."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------

@app.get("/health", response_model=HealthResponse)
async def health():
    """Service health check."""
    return HealthResponse(
        status="ok",
        lightfm_loaded=has_lightfm(),
        xgb_loaded=has_xgb_ranker(),
    )


# ---------------------------------------------------------------------------
# GET /model-info
# ---------------------------------------------------------------------------

@app.get("/model-info", response_model=ModelInfoResponse)
async def model_info():
    """Return model metadata and configuration."""
    bundle = get_bundle()
    return ModelInfoResponse(
        lightfm_available=has_lightfm(),
        xgb_available=has_xgb_ranker(),
        model_metadata=bundle.model_metadata,
        xgb_feature_columns=bundle.xgb_feature_columns,
        hybrid_weights={
            "rule_weight": config.RULE_WEIGHT,
            "model_weight": config.MODEL_WEIGHT,
        },
    )


# ---------------------------------------------------------------------------
# POST /recommendations
# ---------------------------------------------------------------------------

@app.post("/recommendations", response_model=RecommendationResponse)
async def get_recommendations(request: RecommendationRequest):
    """
    Rank candidate movies for a user.

    The response includes LightFM scores, XGBRanker scores,
    rule-based scores, and the final 60/40 hybrid score.
    """
    bundle = get_bundle()

    # Convert candidates to dicts
    candidate_dicts = [
        c.model_dump() if hasattr(c, "model_dump") else c.dict()
        for c in request.candidates
    ]

    # Run inference
    results = recommend(
        user_id=request.user_id,
        candidates=candidate_dicts,
        top_k=request.top_k,
        bundle=bundle,
    )

    recommendations = [
        RecommendationResult(
            movie_id=r["movie_id"],
            lightfm_score=r.get("lightfm_score"),
            ranker_score=r.get("ranker_score"),
            rule_score=r["rule_score"],
            final_score=r["final_score"],
        )
        for r in results
    ]

    model_available = has_lightfm() or has_xgb_ranker()
    fallback = not model_available

    return RecommendationResponse(
        user_id=request.user_id,
        recommendations=recommendations,
        model_available=model_available,
        fallback_used=fallback,
    )


# ---------------------------------------------------------------------------
# POST /hybrid-score
# ---------------------------------------------------------------------------

@app.post("/hybrid-score", response_model=HybridScoreResponse)
async def hybrid_score(request: HybridScoreRequest):
    """Score a single user–movie pair with the hybrid formula."""
    bundle = get_bundle()

    result = compute_hybrid_score(
        rule_score=request.rule_score,
        movie_id=request.movie_id,
        user_id=request.user_id,
        candidate_features={
            "genre_affinity_score": request.genre_affinity_score,
            "language_match_score": request.language_match_score,
            "actor_match_score": request.actor_match_score,
            "director_match_score": request.director_match_score,
            "keyword_similarity_score": request.keyword_similarity_score,
            "tmdb_rating": request.tmdb_rating,
            "tmdb_popularity": request.tmdb_popularity,
            "release_year": request.release_year,
        },
        bundle=bundle,
    )

    return HybridScoreResponse(**result)


# ---------------------------------------------------------------------------
# Run with uvicorn
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "src.api:app",
        host=config.API_HOST,
        port=config.API_PORT,
        reload=True,
    )
