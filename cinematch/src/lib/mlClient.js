/**
 * CineMatch ML Service Client
 *
 * HTTP client for communicating with the Python FastAPI recommendation engine.
 * Handles request/response serialization, timeouts, and graceful fallback.
 *
 * The ML service runs on a configurable port (default 8000) and provides:
 *   POST /recommendations — Rank candidates with LightFM + XGBRanker
 *   POST /hybrid-score    — Score a single user–movie pair
 *   GET  /health          — Check if the service is alive
 *   GET  /model-info      — Model metadata and training date
 */

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
const ML_SERVICE_TIMEOUT = parseInt(process.env.ML_SERVICE_TIMEOUT || '5000', 10);

let _serviceAvailable = null; // cached health status
let _lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL_MS = 30_000; // re-check every 30s

/**
 * Check if the ML service is reachable.
 * Caches result for HEALTH_CHECK_INTERVAL_MS to avoid hammering the service.
 *
 * @returns {Promise<boolean>}
 */
export async function isMLServiceAvailable() {
  const now = Date.now();
  if (_serviceAvailable !== null && now - _lastHealthCheck < HEALTH_CHECK_INTERVAL_MS) {
    return _serviceAvailable;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(`${ML_SERVICE_URL}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      _serviceAvailable = data.status === 'ok';
    } else {
      _serviceAvailable = false;
    }
  } catch {
    _serviceAvailable = false;
  }

  _lastHealthCheck = now;
  return _serviceAvailable;
}

/**
 * Send candidates to the ML service for re-ranking.
 *
 * @param {number} userId - CineMatch internal user ID or global_user_id
 * @param {Array<Object>} candidates - Movies with rule-based scores and features
 * @param {number} [topK=20] - Number of results to return
 * @returns {Promise<Object|null>} Ranked results or null on failure
 *
 * Each candidate should include:
 *   - movie_id: number
 *   - rule_score: number (0–1.5)
 *   - genre_affinity_score?: number
 *   - language_match_score?: number
 *   - actor_match_score?: number
 *   - director_match_score?: number
 *   - tmdb_rating?: number
 *   - tmdb_popularity?: number
 *   - release_year?: number
 *   - source_dataset?: number (0=movielens, 1=indian)
 *   - is_indian_content?: number
 */
export async function getMLRecommendations(userId, candidates, topK = 20) {
  if (!await isMLServiceAvailable()) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ML_SERVICE_TIMEOUT);

    const res = await fetch(`${ML_SERVICE_URL}/recommendations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        user_id: userId,
        candidates: candidates.map(c => ({
          movie_id: c.movie_id,
          rule_score: Math.min(Math.max(c.rule_score || 0, 0), 1.5),
          genre_affinity_score: c.genre_affinity_score ?? 0.5,
          language_match_score: c.language_match_score ?? 0.5,
          actor_match_score: c.actor_match_score ?? 0.0,
          director_match_score: c.director_match_score ?? 0.0,
          keyword_similarity_score: c.keyword_similarity_score ?? 0.0,
          tmdb_rating: c.tmdb_rating ?? 5.0,
          tmdb_popularity: c.tmdb_popularity ?? 50.0,
          release_year: c.release_year ?? 2020,
          source_dataset: c.source_dataset ?? 0,
          is_indian_content: c.is_indian_content ?? 0,
          is_cold_start_movie: c.is_cold_start_movie ?? 0,
        })),
        top_k: topK,
      }),
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[mlClient] ML service returned ${res.status}`);
      return null;
    }

    const data = await res.json();
    return data;
  } catch (err) {
    console.warn('[mlClient] ML service request failed:', err.message);
    // Mark as unavailable so we don't retry immediately
    _serviceAvailable = false;
    _lastHealthCheck = Date.now();
    return null;
  }
}

/**
 * Score a single user–movie pair with the hybrid formula.
 *
 * @param {number} userId
 * @param {number} movieId
 * @param {number} ruleScore
 * @param {Object} [features={}] - Optional additional features
 * @returns {Promise<Object|null>} Score breakdown or null on failure
 */
export async function getHybridScore(userId, movieId, ruleScore, features = {}) {
  if (!await isMLServiceAvailable()) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ML_SERVICE_TIMEOUT);

    const res = await fetch(`${ML_SERVICE_URL}/hybrid-score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        user_id: userId,
        movie_id: movieId,
        rule_score: ruleScore,
        ...features,
      }),
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    return await res.json();
  } catch (err) {
    console.warn('[mlClient] Hybrid score request failed:', err.message);
    return null;
  }
}

/**
 * Get model information and training metadata.
 *
 * @returns {Promise<Object|null>}
 */
export async function getModelInfo() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`${ML_SERVICE_URL}/model-info`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Reset the cached health status (useful after ML service restart).
 */
export function resetMLServiceCache() {
  _serviceAvailable = null;
  _lastHealthCheck = 0;
}
