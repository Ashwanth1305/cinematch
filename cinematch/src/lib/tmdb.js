/**
 * TMDB API Integration Module
 * Handles all communication with The Movie Database API
 */

const TMDB_BASE = process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3';
const TMDB_KEY = (process.env.TMDB_API_KEY || process.env.NEXT_PUBLIC_TMDB_API_KEY || '').trim();
const TMDB_BEARER_TOKEN = (process.env.TMDB_READ_ACCESS_TOKEN || process.env.TMDB_BEARER_TOKEN || '').trim();
const TMDB_IMAGE = process.env.TMDB_IMAGE_BASE || 'https://image.tmdb.org/t/p';
const PLACEHOLDER_TMDB_VALUES = new Set([
  'demo_key',
  'your_tmdb_api_key_here',
  'your_tmdb_read_access_token_here',
  'changeme',
  'replace_me'
]);

export function hasValidTmdbConfig() {
  return Boolean(
    (TMDB_KEY && !PLACEHOLDER_TMDB_VALUES.has(TMDB_KEY)) ||
    (TMDB_BEARER_TOKEN && !PLACEHOLDER_TMDB_VALUES.has(TMDB_BEARER_TOKEN))
  );
}

// TMDB Provider IDs for supported OTT platforms (India region)
const SUPPORTED_PROVIDERS = {
  8: 'Netflix',
  119: 'Prime Video',
  122: 'Hotstar',
  220: 'Jio Cinema',
  232: 'Zee5',
  237: 'SonyLIV',
  350: 'Apple TV+',
  561: 'Lionsgate Play'
};

const PROVIDER_ID_MAP = {
  'Netflix': 8,
  'Prime Video': 119,
  'Hotstar': 122,
  'Jio Cinema': 220,
  'Zee5': 232,
  'SonyLIV': 237,
  'Apple TV+': 350,
  'Lionsgate Play': 561
};

/**
 * Rate-limited fetch with exponential backoff
 */
let requestQueue = [];
let isProcessing = false;
const RATE_LIMIT = 40; // max requests per 10 seconds
const RATE_WINDOW = 10000; // 10 seconds
let requestTimestamps = [];
const FETCH_TIMEOUT = 5000; // 5 second timeout per request

async function rateLimitedFetch(url) {
  if (!hasValidTmdbConfig()) {
    throw new Error('TMDB API is not configured. Add TMDB_API_KEY or TMDB_READ_ACCESS_TOKEN to .env.local');
  }

  // Clean old timestamps
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter(t => now - t < RATE_WINDOW);

  if (requestTimestamps.length >= RATE_LIMIT) {
    const oldestInWindow = requestTimestamps[0];
    const waitTime = RATE_WINDOW - (now - oldestInWindow) + 100;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  requestTimestamps.push(Date.now());

  let retries = 0;
  const maxRetries = 2; // Reduced from 5 to fail fast

  while (retries < maxRetries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
      const headers = {};
      if (TMDB_BEARER_TOKEN && !PLACEHOLDER_TMDB_VALUES.has(TMDB_BEARER_TOKEN)) {
        headers.Authorization = `Bearer ${TMDB_BEARER_TOKEN}`;
      }

      const response = await fetch(url, { signal: controller.signal, headers });
      clearTimeout(timeoutId);

      if (response.status === 429) {
        // Rate limited - short backoff
        const waitTime = Math.min(1000 * Math.pow(2, retries), 3000);
        console.warn(`TMDB rate limited. Waiting ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        retries++;
        continue;
      }
      if (!response.ok) {
        throw new Error(`TMDB API error: ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (retries === maxRetries - 1) throw error;
      retries++;
      const waitTime = Math.min(1000 * Math.pow(2, retries), 3000);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

/**
 * Build a TMDB API URL with the API key
 */
function buildUrl(endpoint, params = {}) {
  const url = new URL(`${TMDB_BASE}${endpoint}`);

  if (TMDB_BEARER_TOKEN && !PLACEHOLDER_TMDB_VALUES.has(TMDB_BEARER_TOKEN)) {
    // bearer token auth is handled in fetch headers
  } else if (TMDB_KEY && !PLACEHOLDER_TMDB_VALUES.has(TMDB_KEY)) {
    url.searchParams.set('api_key', TMDB_KEY);
  }

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
}

/**
 * Get image URL at specified size
 */
export function getImageUrl(path, size = 'w500') {
  if (!path) return '/placeholder-poster.jpg';
  return `${TMDB_IMAGE}/${size}${path}`;
}

/**
 * Fetch trending movies for the week
 */
export async function getTrendingMovies(page = 1) {
  const url = buildUrl('/trending/movie/week', { page, region: 'IN' });
  const data = await rateLimitedFetch(url);
  return data.results || [];
}

/**
 * Fetch trending TV series for the week
 */
export async function getTrendingTV(page = 1) {
  const url = buildUrl('/trending/tv/week', { page, region: 'IN' });
  const data = await rateLimitedFetch(url);
  return data.results || [];
}

/**
 * Fetch upcoming movies
 */
export async function getUpcomingMovies(page = 1) {
  const url = buildUrl('/movie/upcoming', { page, region: 'IN' });
  const data = await rateLimitedFetch(url);
  return data.results || [];
}

/**
 * Fetch watch providers for a movie
 */
export async function getMovieProviders(tmdbId) {
  const url = buildUrl(`/movie/${tmdbId}/watch/providers`);
  const data = await rateLimitedFetch(url);
  const inProviders = data.results?.IN;
  if (!inProviders) return [];

  const flatrate = inProviders.flatrate || [];
  return flatrate
    .filter(p => SUPPORTED_PROVIDERS[p.provider_id])
    .map(p => ({
      id: p.provider_id,
      name: SUPPORTED_PROVIDERS[p.provider_id],
      logo: `https://image.tmdb.org/t/p/w92${p.logo_path}`
    }));
}

/**
 * Fetch watch providers for a TV series
 */
export async function getTVProviders(tmdbId) {
  const url = buildUrl(`/tv/${tmdbId}/watch/providers`);
  const data = await rateLimitedFetch(url);
  const inProviders = data.results?.IN;
  if (!inProviders) return [];

  const flatrate = inProviders.flatrate || [];
  return flatrate
    .filter(p => SUPPORTED_PROVIDERS[p.provider_id])
    .map(p => ({
      id: p.provider_id,
      name: SUPPORTED_PROVIDERS[p.provider_id],
      logo: `https://image.tmdb.org/t/p/w92${p.logo_path}`
    }));
}

/**
 * Fetch movie details including credits
 */
export async function getMovieDetails(tmdbId) {
  const url = buildUrl(`/movie/${tmdbId}`, { append_to_response: 'credits,keywords' });
  const data = await rateLimitedFetch(url);

  const director = data.credits?.crew?.find(c => c.job === 'Director');
  const topCast = (data.credits?.cast || []).slice(0, 4).map(c => c.name);
  const keywords = (data.keywords?.keywords || []).map(k => k.name);

  return {
    tmdb_id: data.id,
    title: data.title,
    overview: data.overview,
    poster_url: data.poster_path,
    backdrop_url: data.backdrop_path,
    imdb_rating: data.vote_average || 0,
    content_type: 'movie',
    release_date: data.release_date,
    genres: (data.genres || []).map(g => ({ id: g.id, name: g.name })),
    director: director?.name || 'Unknown',
    cast: topCast,
    keywords: keywords,
    budget: data.budget || 0,
    runtime: data.runtime
  };
}

/**
 * Fetch TV series details including credits
 */
export async function getTVDetails(tmdbId) {
  const url = buildUrl(`/tv/${tmdbId}`, { append_to_response: 'credits,keywords' });
  const data = await rateLimitedFetch(url);

  const creator = data.created_by?.[0];
  const topCast = (data.credits?.cast || []).slice(0, 4).map(c => c.name);
  const keywords = (data.keywords?.results || []).map(k => k.name);

  return {
    tmdb_id: data.id,
    title: data.name,
    overview: data.overview,
    poster_url: data.poster_path,
    backdrop_url: data.backdrop_path,
    imdb_rating: data.vote_average || 0,
    content_type: 'series',
    release_date: data.first_air_date,
    genres: (data.genres || []).map(g => ({ id: g.id, name: g.name })),
    director: creator?.name || 'Unknown',
    cast: topCast,
    keywords: keywords,
    budget: 0,
    seasons: data.number_of_seasons
  };
}

/**
 * Fetch TMDB genre list (movies)
 */
export async function getGenreList() {
  const url = buildUrl('/genre/movie/list');
  const data = await rateLimitedFetch(url);
  return data.genres || [];
}

/**
 * Discover movies by genre with provider filter
 */
export async function discoverByGenre(genreId, providerIds = [], page = 1) {
  const params = {
    with_genres: genreId,
    sort_by: 'vote_average.desc',
    'vote_count.gte': 50,
    watch_region: 'IN',
    page
  };

  if (providerIds.length > 0) {
    params.with_watch_providers = providerIds.join('|');
  }

  const url = buildUrl('/discover/movie', params);
  const data = await rateLimitedFetch(url);
  return data.results || [];
}

/**
 * Discover TV series by genre with provider filter
 */
export async function discoverTVByGenre(genreId, providerIds = [], page = 1) {
  const params = {
    with_genres: genreId,
    sort_by: 'vote_average.desc',
    'vote_count.gte': 50,
    watch_region: 'IN',
    page
  };

  if (providerIds.length > 0) {
    params.with_watch_providers = providerIds.join('|');
  }

  const url = buildUrl('/discover/tv', params);
  const data = await rateLimitedFetch(url);
  return data.results || [];
}

/**
 * Search movies/TV
 */
export async function searchMulti(query, page = 1) {
  const url = buildUrl('/search/multi', { query, page, region: 'IN' });
  const data = await rateLimitedFetch(url);
  return (data.results || []).filter(r => r.media_type === 'movie' || r.media_type === 'tv');
}

/**
 * Get popular movies for onboarding "Pick 5"
 */
export async function getPopularForOnboarding(providerIds = []) {
  const params = {
    sort_by: 'popularity.desc',
    'vote_count.gte': 500,
    'vote_average.gte': 6.5,
    watch_region: 'IN',
    page: 1
  };

  if (providerIds.length > 0) {
    params.with_watch_providers = providerIds.join('|');
  }

  const url = buildUrl('/discover/movie', params);
  const data = await rateLimitedFetch(url);

  // Fetch page 2 as well for more variety
  params.page = 2;
  const url2 = buildUrl('/discover/movie', params);
  const data2 = await rateLimitedFetch(url2);

  return [...(data.results || []), ...(data2.results || [])].slice(0, 30);
}

export { SUPPORTED_PROVIDERS, PROVIDER_ID_MAP };
