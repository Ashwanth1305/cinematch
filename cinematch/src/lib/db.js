/**
 * Local Data Store
 * Development-only in-memory + file-based persistence
 * Replace with PostgreSQL in production
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import bcryptjs from 'bcryptjs';
import { getMovieDetails, getMovieProviders, hasValidTmdbConfig } from '@/lib/tmdb';
import { query as pgQuery } from './postgres';

const DATA_DIR = path.join(process.cwd(), '.data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadData(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  return null;
}

function saveData(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filePath);
}

// PostgreSQL live write helper
async function syncToPostgres(sql, params) {
  try {
    await pgQuery(sql, params);
  } catch (err) {
    console.warn('[PostgreSQL Sync Warning]:', err.message);
  }
}

// ==========================================
// OTT Platforms (static seed data)
// ==========================================
const OTT_PLATFORMS = [
  { id: 1, name: 'Netflix',        logo_url: '/platforms/netflix.png',      deep_link_scheme: 'netflix://',       web_base_url: 'https://www.netflix.com',        tmdb_provider_id: 8,   tmdb_provider_ids: [8] },
  { id: 2, name: 'Prime Video',    logo_url: '/platforms/prime-video.png',  deep_link_scheme: 'primevideo://',    web_base_url: 'https://www.primevideo.com',     tmdb_provider_id: 119, tmdb_provider_ids: [119] },
  { id: 3, name: 'JioHotstar',     logo_url: '/platforms/jiohotstar.png',   deep_link_scheme: 'hotstar://',       web_base_url: 'https://www.jiohotstar.com',     tmdb_provider_id: 122, tmdb_provider_ids: [122, 220] },
  { id: 5, name: 'Zee5',           logo_url: '/platforms/zee5.png',         deep_link_scheme: 'zee5://',          web_base_url: 'https://www.zee5.com',           tmdb_provider_id: 232, tmdb_provider_ids: [232] },
  { id: 6, name: 'SonyLIV',        logo_url: '/platforms/sonyliv.png',      deep_link_scheme: 'sonyliv://',       web_base_url: 'https://www.sonyliv.com',        tmdb_provider_id: 237, tmdb_provider_ids: [237] },
  { id: 7, name: 'Apple TV+',      logo_url: '/platforms/apple-tv.png',     deep_link_scheme: 'appletv://',       web_base_url: 'https://tv.apple.com',           tmdb_provider_id: 350, tmdb_provider_ids: [350] },
  { id: 8, name: 'Lionsgate Play', logo_url: '/platforms/lionsgate.png',    deep_link_scheme: 'lionsgateplay://', web_base_url: 'https://www.lionsgateplay.com',  tmdb_provider_id: 561, tmdb_provider_ids: [561] }
];

// Genres (static seed data)
const GENRES = [
  { id: 1,  name: 'Action',      slug: 'action',      icon: '⚡', tmdb_genre_id: 28    },
  { id: 2,  name: 'Comedy',      slug: 'comedy',      icon: '😂', tmdb_genre_id: 35    },
  { id: 3,  name: 'Horror',      slug: 'horror',      icon: '👻', tmdb_genre_id: 27    },
  { id: 4,  name: 'Thriller',    slug: 'thriller',    icon: '🔪', tmdb_genre_id: 53    },
  { id: 5,  name: 'Romance',     slug: 'romance',     icon: '💕', tmdb_genre_id: 10749 },
  { id: 6,  name: 'Drama',       slug: 'drama',       icon: '🎭', tmdb_genre_id: 18    },
  { id: 7,  name: 'Sci-Fi',      slug: 'sci-fi',      icon: '🚀', tmdb_genre_id: 878   },
  { id: 8,  name: 'Crime',       slug: 'crime',       icon: '🔫', tmdb_genre_id: 80    },
  { id: 9,  name: 'Documentary', slug: 'documentary', icon: '📹', tmdb_genre_id: 99    },
  { id: 10, name: 'Animation',   slug: 'animation',   icon: '🎨', tmdb_genre_id: 16    }
];

// TMDB Genre ID to local Genre ID mapping
const TMDB_GENRE_MAP = {};
const TMDB_GENRE_SLUG_MAP = {};
GENRES.forEach(g => {
  TMDB_GENRE_MAP[g.tmdb_genre_id] = g.id;
  TMDB_GENRE_SLUG_MAP[g.tmdb_genre_id] = g.slug;
});

// ==========================================
// In-memory stores (persist to JSON files)
// ==========================================
let users = loadData('users.json') || [];
let userOttSubscriptions = loadData('user_ott_subscriptions.json') || [];
let movies = loadData('movies.json') || [];
let movieGenres = loadData('movie_genres.json') || [];
let movieOttAvailability = loadData('movie_ott_availability.json') || [];
let userFeedback = loadData('user_feedback.json') || [];
let userWatchlist = loadData('user_watchlist.json') || [];
let userTasteProfiles = loadData('user_taste_profiles.json') || [];
let watchEvents = loadData('watch_events.json') || [];
let feedbackDismissals = loadData('feedback_dismissals.json') || [];
let sessions = loadData('sessions.json') || [];

export function createSession(userId) {
  const now = Date.now();
  sessions = sessions.filter(session => new Date(session.expires_at).getTime() > now);
  const session = {
    token: uuidv4() + uuidv4(),
    user_id: userId,
    expires_at: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString()
  };
  sessions.push(session);
  saveData('sessions.json', sessions);
  return session;
}

export function findSession(token) {
  if (!token) return null;
  const session = sessions.find(item => item.token === token);
  if (!session || new Date(session.expires_at).getTime() <= Date.now()) return null;
  return session;
}

export function deleteSession(token) {
  sessions = sessions.filter(session => session.token !== token);
  saveData('sessions.json', sessions);
}

// ==========================================
// User Operations
// ==========================================
export function createUser({ email, password, name, authProvider = 'email' }) {
  const existing = users.find(u => u.email === email);
  if (existing) throw new Error('User already exists');

  const user = {
    id: uuidv4(),
    email,
    password_hash: password ? bcryptjs.hashSync(password, 10) : null,
    name,
    auth_provider: authProvider,
    feedback_count: 0,
    onboarding_completed: false,
    created_at: new Date().toISOString()
  };
  users.push(user);
  saveData('users.json', users);

  // Sync to PostgreSQL in real time
  syncToPostgres(`
    INSERT INTO users (id, email, password_hash, feedback_count, created_at)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO NOTHING;
  `, [user.id, user.email, user.password_hash, 0, user.created_at]);

  return user;
}

export function findUserByEmail(email) {
  return users.find(u => u.email === email) || null;
}

export function findUserById(id) {
  return users.find(u => u.id === id) || null;
}

export function verifyPassword(user, password) {
  if (!user.password_hash) return false;
  return bcryptjs.compareSync(password, user.password_hash);
}

export function updateUser(userId, updates) {
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) return null;
  users[idx] = { ...users[idx], ...updates };
  saveData('users.json', users);
  return users[idx];
}

// ==========================================
// OTT Subscription Operations
// ==========================================
export function getOttPlatforms() {
  return OTT_PLATFORMS;
}

export function getUserSubscriptions(userId) {
  const subs = userOttSubscriptions.filter(s => s.user_id === userId);
  return subs.map(s => {
    const platform = OTT_PLATFORMS.find(p => p.id === s.ott_platform_id);
    return { ...s, platform };
  });
}

export function setUserSubscriptions(userId, platformIds) {
  // Remove existing
  userOttSubscriptions = userOttSubscriptions.filter(s => s.user_id !== userId);
  // Add new
  platformIds.forEach(pid => {
    userOttSubscriptions.push({
      user_id: userId,
      ott_platform_id: pid,
      added_at: new Date().toISOString()
    });
  });
  saveData('user_ott_subscriptions.json', userOttSubscriptions);
}

export function getUserProviderIds(userId) {
  const subs = userOttSubscriptions.filter(s => s.user_id === userId);
  return subs.flatMap(s => {
    const platform = OTT_PLATFORMS.find(p => p.id === s.ott_platform_id);
    return platform?.tmdb_provider_ids || (platform?.tmdb_provider_id ? [platform.tmdb_provider_id] : []);
  }).filter(Boolean);
}

// ==========================================
// Genre Operations
// ==========================================
export function getGenres() {
  return GENRES;
}

// ==========================================
// Movie Operations
// ==========================================
export function upsertMovie(movieData) {
  const idx = movies.findIndex(m => m.tmdb_id === movieData.tmdb_id);
  if (idx !== -1) {
    movies[idx] = { ...movies[idx], ...movieData, updated_at: new Date().toISOString() };
  } else {
    const movie = {
      id: movies.length > 0 ? Math.max(...movies.map(m => m.id)) + 1 : 1,
      ...movieData,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    movies.push(movie);
  }
  saveData('movies.json', movies);
  return movies.find(m => m.tmdb_id === movieData.tmdb_id);
}

export function getMovieById(id) {
  const numericId = typeof id === 'string' ? parseInt(id, 10) : id;
  if (!numericId || Number.isNaN(numericId)) return null;
  return movies.find(m => m.id === numericId) || null;
}

export function getMovieByTmdbId(tmdbId) {
  const numericTmdbId = typeof tmdbId === 'string' ? parseInt(tmdbId, 10) : tmdbId;
  if (!numericTmdbId || Number.isNaN(numericTmdbId)) return null;
  return movies.find(m => m.tmdb_id === numericTmdbId) || null;
}

export function getMovieByAnyId(id) {
  return getMovieById(id) || getMovieByTmdbId(id);
}

export function resolveLocalMovieId(id) {
  const movie = getMovieByAnyId(id);
  return movie ? movie.id : null;
}

export function isSameMovieIdentifier(idA, idB) {
  const movieA = getMovieByAnyId(idA);
  const movieB = getMovieByAnyId(idB);
  return Boolean(movieA && movieB && movieA.id === movieB.id);
}

export function getMovieGenreSlugsFromMovieData(movieData) {
  if (!movieData || !Array.isArray(movieData.genres)) return [];

  return movieData.genres.map((genre) => {
    if (typeof genre === 'string') return genre;
    if (typeof genre === 'object') {
      if (genre.slug) return genre.slug;
      if (typeof genre.id === 'number') {
        return TMDB_GENRE_SLUG_MAP[genre.id] || genre.name?.toLowerCase().replace(/\s+/g, '-');
      }
      if (typeof genre.name === 'string') return genre.name.toLowerCase().replace(/\s+/g, '-');
    }
    return null;
  }).filter(Boolean);
}

export async function resolveOrImportMovie(movieId) {
  const resolved = getMovieByAnyId(movieId);
  if (resolved) return resolved;

  const numericId = typeof movieId === 'string' ? parseInt(movieId, 10) : movieId;
  if (!numericId || Number.isNaN(numericId)) return null;

  if (!hasValidTmdbConfig()) return null;

  try {
    const movieData = await getMovieDetails(numericId);
    const providers = await getMovieProviders(numericId);
    const platforms = providers.map(p => ({ id: p.id, name: p.name }));

    const savedMovie = upsertMovie({
      tmdb_id: movieData.tmdb_id,
      title: movieData.title,
      overview: movieData.overview,
      poster_url: movieData.poster_url,
      backdrop_url: movieData.backdrop_url,
      imdb_rating: movieData.imdb_rating,
      content_type: movieData.content_type,
      release_date: movieData.release_date,
      director: movieData.director,
      cast_members: movieData.cast,
      platforms
    });

    const localGenreIds = (movieData.genres || [])
      .map(g => TMDB_GENRE_MAP[g.id])
      .filter(Boolean);
    if (localGenreIds.length > 0) {
      setMovieGenres(savedMovie.id, localGenreIds);
    }

    setMovieAvailability(savedMovie.id, platforms.map(p => ({
      ott_platform_id: p.id,
      watch_url: '',
      availability_type: 'streaming'
    })));

    return savedMovie;
  } catch (err) {
    console.warn('[db] Failed to resolve or import movie', movieId, err.message);
    return null;
  }
}

export function setMovieGenres(movieId, genreIds) {
  movieGenres = movieGenres.filter(mg => mg.movie_id !== movieId);
  genreIds.forEach(gid => {
    movieGenres.push({ movie_id: movieId, genre_id: gid });
  });
  saveData('movie_genres.json', movieGenres);
}

export function setMovieAvailability(movieId, platforms) {
  movieOttAvailability = movieOttAvailability.filter(a => a.movie_id !== movieId);
  platforms.forEach(p => {
    movieOttAvailability.push({
      movie_id: movieId,
      ott_platform_id: p.ott_platform_id,
      watch_url: p.watch_url || '',
      availability_type: p.availability_type || 'streaming'
    });
  });
  saveData('movie_ott_availability.json', movieOttAvailability);
}

export function getMoviesByGenre(genreId, userPlatformIds = [], page = 1, limit = 10, excludeMovieIds = []) {
  const genreMovieIds = movieGenres
    .filter(mg => mg.genre_id === genreId)
    .map(mg => mg.movie_id);

  let filtered = movies.filter(m =>
    genreMovieIds.includes(m.id) &&
    m.status === 'active' &&
    !excludeMovieIds.includes(m.id)
  );

  // Filter by user's OTT platforms
  if (userPlatformIds.length > 0) {
    const availableMovieIds = movieOttAvailability
      .filter(a => {
        const platform = OTT_PLATFORMS.find(p => p.id === a.ott_platform_id);
        return platform && userPlatformIds.includes(platform.tmdb_provider_id) && a.availability_type === 'streaming';
      })
      .map(a => a.movie_id);
    filtered = filtered.filter(m => availableMovieIds.includes(m.id));
  }

  // Sort by IMDB rating descending
  filtered.sort((a, b) => (b.imdb_rating || 0) - (a.imdb_rating || 0));

  const offset = (page - 1) * limit;
  return {
    movies: filtered.slice(offset, offset + limit),
    total: filtered.length,
    page,
    hasMore: offset + limit < filtered.length
  };
}

function getMovieGenreSlugs(movieId) {
  return movieGenres
    .filter(mg => mg.movie_id === movieId)
    .map(mg => GENRES.find(g => g.id === mg.genre_id)?.slug)
    .filter(Boolean);
}

function parseCastMembers(movie) {
  if (!movie?.cast_members) return [];
  if (Array.isArray(movie.cast_members)) return movie.cast_members;
  if (typeof movie.cast_members === 'string') {
    try { return JSON.parse(movie.cast_members); } catch { return []; }
  }
  return [];
}

function getUserGenreVector(userId) {
  const profile = getTasteProfile(userId);
  const vector = {};

  GENRES.forEach(genre => {
    vector[genre.slug] = profile?.genre_affinity?.[genre.slug] ?? 0.5;
  });

  const feedback = getUserFeedback(userId).filter(f => f.watched && f.rating);
  feedback.forEach(entry => {
    const movie = getMovieByAnyId(entry.movie_id);
    if (!movie) return;
    const slugs = getMovieGenreSlugs(movie.id);
    if (!slugs.length) return;
    const boost = ((entry.rating || 0) - 5) / 10;
    slugs.forEach(slug => {
      vector[slug] = Math.max(0, Math.min(1, (vector[slug] || 0.5) + boost * 0.08));
    });
  });

  return vector;
}

function getUserSimilarity(userId, otherUserId) {
  const a = getUserGenreVector(userId);
  const b = getUserGenreVector(otherUserId);
  const genres = GENRES.map(g => g.slug);
  const dot = genres.reduce((sum, slug) => sum + (a[slug] || 0.5) * (b[slug] || 0.5), 0);
  const normA = Math.sqrt(genres.reduce((sum, slug) => sum + (a[slug] || 0.5) ** 2, 0));
  const normB = Math.sqrt(genres.reduce((sum, slug) => sum + (b[slug] || 0.5) ** 2, 0));
  if (!normA || !normB) return 0;
  return dot / (normA * normB);
}

function getCollaborativeBoost(userId, movieId) {
  const feedbackEntries = getUserFeedback(userId).filter(f => f.watched && f.rating);
  if (feedbackEntries.length < 2) return 0;

  const similarScores = [];
  users.forEach(otherUser => {
    if (otherUser.id === userId) return;
    const otherFeedback = getUserFeedback(otherUser.id).find(f => isSameMovieIdentifier(f.movie_id, movieId) && f.watched && f.rating >= 6);
    if (!otherFeedback) return;
    const similarity = getUserSimilarity(userId, otherUser.id);
    if (similarity <= 0.1) return;
    similarScores.push({ similarity, rating: otherFeedback.rating || 0 });
  });

  if (!similarScores.length) return 0;
  const weight = similarScores.reduce((sum, item) => sum + item.similarity, 0);
  const weightedRating = similarScores.reduce((sum, item) => sum + item.similarity * item.rating, 0);
  return weight ? ((weightedRating / weight - 5) / 10) * 0.25 : 0;
}

export function getPersonalizedRecommendations(userId, { limit = 8, platformIds = [], excludeMovieIds = [] } = {}) {
  if (!userId) return [];

  const profile = getTasteProfile(userId);
  const genreAffinity = profile?.genre_affinity || {};
  const watchedMovieIds = new Set(getUserFeedback(userId)
    .filter(f => f.watched)
    .map(f => resolveLocalMovieId(f.movie_id) || f.movie_id));
  const preferredPlatforms = platformIds.length > 0 ? platformIds : getUserProviderIds(userId);

  const candidates = movies.filter(movie => {
    if (movie.status !== 'active') return false;
    if (watchedMovieIds.has(movie.id)) return false;
    if (excludeMovieIds.includes(movie.id)) return false;
    if (preferredPlatforms.length > 0) {
      return (movie.platforms || []).some(platform => preferredPlatforms.includes(platform.id));
    }
    return true;
  });

  if (!candidates.length) return [];

  const scored = candidates.map(movie => {
    const movieGenres = getMovieGenreSlugs(movie.id);
    const castMembers = parseCastMembers(movie);
    const preferredActors = profile?.preferred_actors || [];
    const actorMatches = preferredActors.filter(actor => castMembers.includes(actor)).length;

    let score = 0;
    score += ((movie.imdb_rating || 0) / 10) * 0.45;

    if (movieGenres.length) {
      const genreScore = movieGenres.reduce((sum, slug) => sum + (genreAffinity[slug] ?? 0.5), 0) / movieGenres.length;
      score += genreScore * 0.8;
    }

    if (profile?.preferred_directors?.includes(movie.director)) score += 0.35;
    score += Math.min(actorMatches * 0.12, 0.24);
    score += getCollaborativeBoost(userId, movie.id);

    if (movie.release_date && new Date(movie.release_date) > new Date()) score -= 0.18;

    return { ...movie, recommendation_score: Number(score.toFixed(3)) };
  });

  scored.sort((a, b) => {
    if (b.recommendation_score !== a.recommendation_score) {
      return b.recommendation_score - a.recommendation_score;
    }
    return (b.imdb_rating || 0) - (a.imdb_rating || 0);
  });

  return scored.slice(0, limit).map(({ recommendation_score, ...movie }) => movie);
}

/**
 * Rank an arbitrary TMDB/fallback movie list for a live application user.
 * This is used by genre carousels, whose movies may not exist in the local
 * offline-model ID mapping yet.
 */
export function rankMoviesForUser(userId, movieList = []) {
  if (!userId || !Array.isArray(movieList)) return movieList;

  const profile = getTasteProfile(userId);
  if (!profile) return movieList;

  const watchedIds = new Set(
    getUserFeedback(userId)
      .filter(entry => entry.watched)
      .map(entry => String(entry.movie_id))
  );
  const preferredDirectors = new Set(profile.preferred_directors || []);
  const preferredActors = new Set(profile.preferred_actors || []);

  return movieList
    .map((movie, originalIndex) => {
      const genreSlugs = getMovieGenreSlugsFromMovieData(movie);
      const genreScore = genreSlugs.length
        ? genreSlugs.reduce(
            (sum, slug) => sum + (profile.genre_affinity?.[slug] ?? 0.5),
            0
          ) / genreSlugs.length
        : 0.5;
      const cast = parseCastMembers(movie);
      const actorMatches = cast.filter(actor => preferredActors.has(actor)).length;
      const isWatched = [movie.id, movie.tmdb_id]
        .filter(Boolean)
        .some(id => watchedIds.has(String(resolveLocalMovieId(id) || id)));

      const score =
        ((movie.imdb_rating || 0) / 10) * 0.35 +
        genreScore * 0.65 +
        (preferredDirectors.has(movie.director) ? 0.25 : 0) +
        Math.min(actorMatches * 0.1, 0.3) -
        (isWatched ? 1 : 0);

      return { movie, score, originalIndex };
    })
    .sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex)
    .map(({ movie }) => movie);
}

/**
 * ML-Enhanced Recommendations
 *
 * Async version of getPersonalizedRecommendations that:
 * 1. Computes rule-based scores for all candidates (same as before)
 * 2. Sends scored candidates to the Python ML service
 * 3. The ML service applies: LightFM → XGBRanker → 60% rule + 40% ML
 * 4. Falls back to 100% rule-based if ML service is unavailable
 *
 * @param {string} userId
 * @param {Object} options
 * @returns {Promise<Array>} Ranked movies
 */
export async function getMLEnhancedRecommendations(userId, { limit = 8, platformIds = [], excludeMovieIds = [] } = {}) {
  if (!userId) return [];

  // --- Step 1: Compute rule-based scores (same logic as above) ----------
  const profile = getTasteProfile(userId);
  const genreAffinity = profile?.genre_affinity || {};
  const watchedMovieIds = new Set(getUserFeedback(userId)
    .filter(f => f.watched)
    .map(f => resolveLocalMovieId(f.movie_id) || f.movie_id));
  const preferredPlatforms = platformIds.length > 0 ? platformIds : getUserProviderIds(userId);

  const filteredCandidates = movies.filter(movie => {
    if (movie.status !== 'active') return false;
    if (watchedMovieIds.has(movie.id)) return false;
    if (excludeMovieIds.includes(movie.id)) return false;
    if (preferredPlatforms.length > 0) {
      return (movie.platforms || []).some(platform => preferredPlatforms.includes(platform.id));
    }
    return true;
  });

  if (!filteredCandidates.length) return [];

  const scoredCandidates = filteredCandidates.map(movie => {
    const movieGenreSlugs = getMovieGenreSlugs(movie.id);
    const castMembers = parseCastMembers(movie);
    const preferredActors = profile?.preferred_actors || [];
    const actorMatches = preferredActors.filter(actor => castMembers.includes(actor)).length;

    let ruleScore = 0;
    ruleScore += ((movie.imdb_rating || 0) / 10) * 0.45;

    let genreAffinityScore = 0.5;
    if (movieGenreSlugs.length) {
      genreAffinityScore = movieGenreSlugs.reduce((sum, slug) => sum + (genreAffinity[slug] ?? 0.5), 0) / movieGenreSlugs.length;
      ruleScore += genreAffinityScore * 0.8;
    }

    const directorMatch = profile?.preferred_directors?.includes(movie.director) ? 1.0 : 0.0;
    if (directorMatch) ruleScore += 0.35;
    const actorMatchScore = Math.min(actorMatches * 0.12, 0.24);
    ruleScore += actorMatchScore;
    ruleScore += getCollaborativeBoost(userId, movie.id);

    if (movie.release_date && new Date(movie.release_date) > new Date()) ruleScore -= 0.18;

    // Extract release year from release_date
    let releaseYear = 2020;
    if (movie.release_date) {
      const yr = new Date(movie.release_date).getFullYear();
      if (yr >= 1900 && yr <= 2030) releaseYear = yr;
    }

    return {
      movie,
      mlCandidate: {
        movie_id: movie.tmdb_id || movie.id,
        rule_score: Number(Math.max(0, ruleScore).toFixed(4)),
        genre_affinity_score: Number(genreAffinityScore.toFixed(4)),
        language_match_score: 0.5, // Not available in CineMatch app context
        actor_match_score: Number(Math.min(actorMatchScore, 1.0).toFixed(4)),
        director_match_score: directorMatch,
        tmdb_rating: movie.imdb_rating || movie.tmdb_rating || 5.0,
        tmdb_popularity: movie.popularity || 50.0,
        release_year: releaseYear,
        source_dataset: 0,
        is_indian_content: 0,
        // TMDB/local IDs are outside the offline model's global movie mapping.
        // Mark them explicitly so XGBRanker uses its learned cold-start path.
        is_cold_start_movie: 1,
      },
      ruleScore: Number(ruleScore.toFixed(3)),
    };
  });

  // --- Step 2: Try ML service -------------------------------------------
  try {
    const { getMLRecommendations } = await import('./mlClient.js');
    const mlResult = await getMLRecommendations(
      userId,
      scoredCandidates.map(c => c.mlCandidate),
      limit,
    );

    if (mlResult && mlResult.recommendations && mlResult.recommendations.length > 0) {
      // Map ML results back to movie objects
      const movieLookup = {};
      scoredCandidates.forEach(c => {
        movieLookup[c.mlCandidate.movie_id] = c.movie;
      });

      const mlRanked = mlResult.recommendations
        .map(rec => movieLookup[rec.movie_id])
        .filter(Boolean);

      if (mlRanked.length > 0) {
        console.log(`[ML] Returned ${mlRanked.length} ML-ranked recommendations for user ${userId}`);
        return mlRanked.slice(0, limit);
      }
    }
  } catch (err) {
    console.warn('[ML] ML service call failed, falling back to rule-based:', err.message);
  }

  // --- Step 3: Fallback to rule-based -----------------------------------
  scoredCandidates.sort((a, b) => {
    if (b.ruleScore !== a.ruleScore) return b.ruleScore - a.ruleScore;
    return (b.movie.imdb_rating || 0) - (a.movie.imdb_rating || 0);
  });

  return scoredCandidates.slice(0, limit).map(c => c.movie);
}

export function getTrendingMovies(userPlatformIds = [], limit = 15) {
  let filtered = movies.filter(m => m.status === 'active');

  if (userPlatformIds.length > 0) {
    const availableMovieIds = movieOttAvailability
      .filter(a => {
        const platform = OTT_PLATFORMS.find(p => p.id === a.ott_platform_id);
        return platform && userPlatformIds.includes(platform.tmdb_provider_id);
      })
      .map(a => a.movie_id);
    filtered = filtered.filter(m => availableMovieIds.includes(m.id));
  }

  filtered.sort((a, b) => (b.imdb_rating || 0) - (a.imdb_rating || 0));
  return filtered.slice(0, limit);
}

export function getComingSoon(userPlatformIds = []) {
  const comingSoonMovieIds = movieOttAvailability
    .filter(a => {
      const platform = OTT_PLATFORMS.find(p => p.id === a.ott_platform_id);
      return a.availability_type === 'coming_soon' && platform && userPlatformIds.includes(platform.tmdb_provider_id);
    })
    .map(a => a.movie_id);

  return movies.filter(m => comingSoonMovieIds.includes(m.id) && m.status === 'active')
    .sort((a, b) => new Date(a.coming_date || a.release_date) - new Date(b.coming_date || b.release_date));
}

export function getLeavingSoon(userPlatformIds = []) {
  const leavingMovieIds = movieOttAvailability
    .filter(a => {
      const platform = OTT_PLATFORMS.find(p => p.id === a.ott_platform_id);
      return a.availability_type === 'leaving_soon' && platform && userPlatformIds.includes(platform.tmdb_provider_id);
    })
    .map(a => a.movie_id);

  return movies.filter(m => leavingMovieIds.includes(m.id) && m.status === 'active')
    .sort((a, b) => new Date(a.leaving_date || 0) - new Date(b.leaving_date || 0));
}

export function getMovieAvailability(movieId) {
  return movieOttAvailability
    .filter(a => a.movie_id === movieId)
    .map(a => ({
      ...a,
      platform: OTT_PLATFORMS.find(p => p.id === a.ott_platform_id)
    }));
}

// ==========================================
// Watchlist Operations
// ==========================================
export function addToWatchlist(userId, movieId) {
  const existing = userWatchlist.find(w => w.user_id === userId && w.movie_id === movieId);
  if (existing) return existing;

  const entry = {
    user_id: userId,
    movie_id: movieId,
    status: 'going_to_watch',
    marked_at: new Date().toISOString()
  };
  userWatchlist.push(entry);
  saveData('user_watchlist.json', userWatchlist);
  return entry;
}

export function getUserWatchlist(userId, status = null) {
  let list = userWatchlist.filter(w => w.user_id === userId);
  if (status) list = list.filter(w => w.status === status);
  return list.map(w => ({
    ...w,
    movie: movies.find(m => m.id === w.movie_id)
  })).sort((a, b) => new Date(b.marked_at) - new Date(a.marked_at));
}

export function updateWatchlistStatus(userId, movieId, status) {
  const idx = userWatchlist.findIndex(w => w.user_id === userId && w.movie_id === movieId);
  if (idx === -1) return null;
  userWatchlist[idx].status = status;
  saveData('user_watchlist.json', userWatchlist);
  return userWatchlist[idx];
}

export function getWatchlistMovieIds(userId) {
  return userWatchlist.filter(w => w.user_id === userId).map(w => w.movie_id);
}

// ==========================================
// Feedback Operations
// ==========================================
export function submitFeedback(userId, movieId, { watched, rating, likedAspects }) {
  const entry = {
    id: uuidv4(),
    user_id: userId,
    movie_id: movieId,
    watched,
    rating: watched ? rating : null,
    liked_aspects: watched ? likedAspects : null,
    created_at: new Date().toISOString()
  };
  userFeedback.push(entry);
  saveData('user_feedback.json', userFeedback);

  // Increment feedback count in memory
  const userIdx = users.findIndex(u => u.id === userId);
  if (userIdx !== -1) {
    users[userIdx].feedback_count = (users[userIdx].feedback_count || 0) + 1;
    saveData('users.json', users);
  }

  // Sync to PostgreSQL in real time
  syncToPostgres(`
    INSERT INTO user_feedback (id, user_id, movie_id, watched, rating, liked_aspects, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (id) DO UPDATE SET
      watched = EXCLUDED.watched,
      rating = EXCLUDED.rating,
      liked_aspects = EXCLUDED.liked_aspects;
  `, [
    entry.id, entry.user_id, entry.movie_id, entry.watched ? 1 : 0, entry.rating,
    JSON.stringify(entry.liked_aspects || []), entry.created_at
  ]);

  syncToPostgres(`
    UPDATE users SET feedback_count = COALESCE(feedback_count, 0) + 1 WHERE id = $1;
  `, [userId]);

  // Update watchlist status if watched
  if (watched) {
    updateWatchlistStatus(userId, movieId, 'watched');
  }

  return entry;
}

export function getUserFeedback(userId) {
  return userFeedback.filter(f => f.user_id === userId);
}

export function getPendingFeedbackMovies(userId) {
  const goingToWatch = userWatchlist.filter(w => w.user_id === userId && w.status === 'going_to_watch');
  const feedbackMovieIds = userFeedback.filter(f => f.user_id === userId).map(f => f.movie_id);
  const dismissedMaxed = feedbackDismissals
    .filter(d => d.user_id === userId && d.dismissal_count >= 3)
    .map(d => d.movie_id);

  return goingToWatch
    .filter(w => !feedbackMovieIds.includes(w.movie_id) && !dismissedMaxed.includes(w.movie_id))
    .sort((a, b) => new Date(b.marked_at) - new Date(a.marked_at))
    .map(w => ({
      ...w,
      movie: movies.find(m => m.id === w.movie_id)
    }));
}

export function dismissFeedback(userId, movieId) {
  const idx = feedbackDismissals.findIndex(d => d.user_id === userId && d.movie_id === movieId);
  if (idx !== -1) {
    feedbackDismissals[idx].dismissal_count += 1;
    feedbackDismissals[idx].last_dismissed_at = new Date().toISOString();
  } else {
    feedbackDismissals.push({
      user_id: userId,
      movie_id: movieId,
      dismissal_count: 1,
      last_dismissed_at: new Date().toISOString()
    });
  }
  saveData('feedback_dismissals.json', feedbackDismissals);
}

// ==========================================
// Taste Profile Operations
// ==========================================
export function createTasteProfile(userId, initialData = {}) {
  const profile = {
    user_id: userId,
    genre_affinity: initialData.genre_affinity || {},
    plot_weight: 0.2,
    direction_weight: 0.2,
    acting_weight: 0.2,
    vfx_weight: 0.2,
    music_weight: 0.2,
    preferred_directors: initialData.preferred_directors || [],
    preferred_actors: initialData.preferred_actors || [],
    last_updated: new Date().toISOString()
  };

  const idx = userTasteProfiles.findIndex(p => p.user_id === userId);
  if (idx !== -1) {
    userTasteProfiles[idx] = { ...userTasteProfiles[idx], ...profile };
  } else {
    userTasteProfiles.push(profile);
  }
  saveData('user_taste_profiles.json', userTasteProfiles);
  return profile;
}

export function getTasteProfile(userId) {
  return userTasteProfiles.find(p => p.user_id === userId) || null;
}

export function updateTasteProfile(userId, feedback, movieData) {
  let profile = getTasteProfile(userId);
  if (!profile) {
    profile = createTasteProfile(userId);
  }

  if (feedback.watched && feedback.rating) {
    // Update genre affinity
    const genreAffinity = { ...profile.genre_affinity };
    const resolvedMovie = getMovieByAnyId(feedback.movie_id) || movieData;
    const resolvedMovieId = resolvedMovie?.id || feedback.movie_id;
    const movieGenreIds = movieGenres.filter(mg => mg.movie_id === resolvedMovieId).map(mg => mg.genre_id);
    const movieGenreSlugs = getMovieGenreSlugsFromMovieData(movieData);

    if (movieGenreIds.length) {
      movieGenreIds.forEach(gid => {
        const genre = GENRES.find(g => g.id === gid);
        if (genre) {
          const currentAffinity = genreAffinity[genre.slug] || 0.5;
          const ratingFactor = (feedback.rating - 5) / 10; // -0.5 to +0.5
          genreAffinity[genre.slug] = Math.max(0, Math.min(1, currentAffinity + ratingFactor * 0.3));
        }
      });
    } else if (movieGenreSlugs.length) {
      movieGenreSlugs.forEach(slug => {
        const currentAffinity = genreAffinity[slug] || 0.5;
        const ratingFactor = (feedback.rating - 5) / 10;
        genreAffinity[slug] = Math.max(0, Math.min(1, currentAffinity + ratingFactor * 0.3));
      });
    }

    profile.genre_affinity = genreAffinity;

    // Update aspect weights
    if (feedback.liked_aspects && feedback.liked_aspects.length > 0) {
      const aspectMap = {
        plot: 'plot_weight',
        direction: 'direction_weight',
        acting: 'acting_weight',
        vfx: 'vfx_weight',
        music: 'music_weight'
      };

      feedback.liked_aspects.forEach(aspect => {
        const key = aspectMap[aspect];
        if (key) {
          profile[key] = (profile[key] || 0.2) + 0.05;
        }
      });

      // Normalize weights to sum to 1.0
      const totalWeight = profile.plot_weight + profile.direction_weight +
        profile.acting_weight + profile.vfx_weight + profile.music_weight;
      if (totalWeight > 0) {
        profile.plot_weight /= totalWeight;
        profile.direction_weight /= totalWeight;
        profile.acting_weight /= totalWeight;
        profile.vfx_weight /= totalWeight;
        profile.music_weight /= totalWeight;
      }
    }

    // Update preferred directors
    if (movieData?.director && movieData.director !== 'Unknown') {
      const directorFeedbacks = userFeedback
        .filter(f => f.user_id === userId && f.watched && f.rating >= 7)
        .map(f => movies.find(m => m.id === f.movie_id))
        .filter(m => m?.director === movieData.director);

      if (directorFeedbacks.length >= 2 && !profile.preferred_directors.includes(movieData.director)) {
        profile.preferred_directors.push(movieData.director);
      }
    }

    // Update preferred actors
    if (movieData?.cast_members) {
      const castArray = typeof movieData.cast_members === 'string'
        ? JSON.parse(movieData.cast_members)
        : movieData.cast_members;

      castArray.forEach(actor => {
        const actorFeedbacks = userFeedback
          .filter(f => f.user_id === userId && f.watched && f.rating >= 7)
          .map(f => movies.find(m => m.id === f.movie_id))
          .filter(m => {
            const cast = typeof m?.cast_members === 'string' ? JSON.parse(m.cast_members) : m?.cast_members;
            return cast?.includes(actor);
          });

        if (actorFeedbacks.length >= 2 && !profile.preferred_actors.includes(actor)) {
          profile.preferred_actors.push(actor);
        }
      });
    }

    profile.last_updated = new Date().toISOString();
  } else if (!feedback.watched) {
    // Minor negative adjustment
    const movieGenreIds = movieGenres.filter(mg => mg.movie_id === feedback.movie_id).map(mg => mg.genre_id);
    const genreAffinity = { ...profile.genre_affinity };
    movieGenreIds.forEach(gid => {
      const genre = GENRES.find(g => g.id === gid);
      if (genre) {
        const currentAffinity = genreAffinity[genre.slug] || 0.5;
        genreAffinity[genre.slug] = Math.max(0, currentAffinity - 0.02);
      }
    });
    profile.genre_affinity = genreAffinity;
    profile.last_updated = new Date().toISOString();
  }

  const idx = userTasteProfiles.findIndex(p => p.user_id === userId);
  if (idx !== -1) {
    userTasteProfiles[idx] = profile;
  }
  saveData('user_taste_profiles.json', userTasteProfiles);
  return profile;
}

// ==========================================
// Watch Events
// ==========================================
export function logWatchEvent(userId, movieId, platformId) {
  const event = {
    id: uuidv4(),
    user_id: userId,
    movie_id: movieId,
    platform_id: platformId,
    created_at: new Date().toISOString()
  };
  watchEvents.push(event);
  saveData('watch_events.json', watchEvents);
  return event;
}

// Export constants
export { OTT_PLATFORMS, GENRES, TMDB_GENRE_MAP };
