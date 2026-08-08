import { NextResponse } from 'next/server';
import { searchMulti, getMovieProviders, getTVProviders, hasValidTmdbConfig } from '@/lib/tmdb';

// TMDB genre ID → slug mapping
const GENRE_MAP = {
  28: 'action', 35: 'comedy', 27: 'horror', 53: 'thriller',
  10749: 'romance', 18: 'drama', 878: 'sci-fi', 80: 'crime',
  99: 'documentary', 16: 'animation', 12: 'adventure',
  14: 'fantasy', 36: 'history', 10402: 'music', 9648: 'mystery',
  10752: 'war', 37: 'western', 10770: 'tv-movie', 10751: 'family'
};

// Fallback search data for when TMDB is unavailable
const FALLBACK_MOVIES = [
  { id: 27205, tmdb_id: 27205, title: 'Inception', overview: 'A thief who steals corporate secrets through dream-sharing technology is given the task of planting an idea.', poster_url: '/xlaY2zyzMfkhk0HSC5VUwzoZPU1.jpg', imdb_rating: 8.4, content_type: 'movie', release_date: '2010-07-16', genres: ['action', 'sci-fi', 'thriller'], platforms: [{ id: 119, name: 'Prime Video' }] },
  { id: 155, tmdb_id: 155, title: 'The Dark Knight', overview: 'Batman must accept one of the greatest psychological and physical tests to fight injustice.', poster_url: '/qJ2tW6WMUDux911r6m7haRef0WH.jpg', imdb_rating: 9.0, content_type: 'movie', release_date: '2008-07-16', genres: ['action', 'crime', 'drama'], platforms: [{ id: 119, name: 'Prime Video' }] },
  { id: 157336, tmdb_id: 157336, title: 'Interstellar', overview: 'A team of explorers travel through a wormhole in space.', poster_url: '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg', imdb_rating: 8.7, content_type: 'movie', release_date: '2014-11-05', genres: ['sci-fi', 'drama'], platforms: [{ id: 119, name: 'Prime Video' }] },
  { id: 496243, tmdb_id: 496243, title: 'Parasite', overview: 'Greed and class discrimination threaten a symbiotic relationship.', poster_url: '/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg', imdb_rating: 8.5, content_type: 'movie', release_date: '2019-05-30', genres: ['drama', 'comedy', 'thriller'], platforms: [{ id: 119, name: 'Prime Video' }] },
  { id: 550, tmdb_id: 550, title: 'Fight Club', overview: 'An insomniac office worker looking for a way to change his life crosses paths with a soap salesman.', poster_url: '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg', imdb_rating: 8.8, content_type: 'movie', release_date: '1999-10-15', genres: ['drama', 'thriller'], platforms: [{ id: 8, name: 'Netflix' }] },
  { id: 680, tmdb_id: 680, title: 'Pulp Fiction', overview: 'The lives of two mob hitmen, a boxer and a pair of diner bandits intertwine.', poster_url: '/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg', imdb_rating: 8.9, content_type: 'movie', release_date: '1994-09-10', genres: ['crime', 'thriller'], platforms: [{ id: 119, name: 'Prime Video' }] },
  { id: 278, tmdb_id: 278, title: 'The Shawshank Redemption', overview: 'A banker sentenced to life in prison forms a friendship.', poster_url: '/9cjIGRiQagNMaGpP6VlVLlaIKnb.jpg', imdb_rating: 9.3, content_type: 'movie', release_date: '1994-09-23', genres: ['drama', 'crime'], platforms: [{ id: 8, name: 'Netflix' }, { id: 119, name: 'Prime Video' }] },
  { id: 603, tmdb_id: 603, title: 'The Matrix', overview: 'A computer hacker learns about the true nature of reality.', poster_url: '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg', imdb_rating: 8.7, content_type: 'movie', release_date: '1999-03-30', genres: ['action', 'sci-fi'], platforms: [{ id: 8, name: 'Netflix' }] },
];

// In-memory search cache
const searchCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim() || '';

    if (!query) {
      return NextResponse.json({ movies: [], query: '' });
    }

    // Check cache
    const cacheKey = `search_${query.toLowerCase()}`;
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json({ movies: cached.data, query, total: cached.data.length });
    }

    let results = [];

    if (hasValidTmdbConfig()) {
      try {
        // Try TMDB search first when configured
        const raw = await searchMulti(query, 1);

        const itemsToProcess = raw.slice(0, 20);
        results = await Promise.all(
          itemsToProcess.map(async (item) => {
            const isMovie = item.media_type === 'movie';
            let providers = [];
            try {
              providers = isMovie
                ? await getMovieProviders(item.id)
                : await getTVProviders(item.id);
            } catch {
              providers = [];
            }

            return {
              id: item.id,
              tmdb_id: item.id,
              title: item.title || item.name,
              overview: item.overview,
              poster_url: item.poster_path,
              backdrop_url: item.backdrop_path,
              imdb_rating: Math.round((item.vote_average || 0) * 10) / 10,
              content_type: isMovie ? 'movie' : 'series',
              release_date: item.release_date || item.first_air_date,
              genres: (item.genre_ids || []).map(gid => GENRE_MAP[gid] || 'other').filter(g => g !== 'other'),
              platforms: providers,
              director: null,
              cast_members: []
            };
          })
        );
      } catch (err) {
        console.warn('TMDB search failed, using fallback:', err.message);
        const q = query.toLowerCase();
        results = FALLBACK_MOVIES.filter(m =>
          m.title.toLowerCase().includes(q) ||
          m.overview.toLowerCase().includes(q) ||
          m.genres.some(g => g.includes(q))
        );
      }
    } else {
      const q = query.toLowerCase();
      results = FALLBACK_MOVIES.filter(m =>
        m.title.toLowerCase().includes(q) ||
        m.overview.toLowerCase().includes(q) ||
        m.genres.some(g => g.includes(q))
      );
    }

    // Cache results
    searchCache.set(cacheKey, { data: results, timestamp: Date.now() });

    // Prune old cache entries
    if (searchCache.size > 100) {
      const now = Date.now();
      for (const [key, val] of searchCache) {
        if (now - val.timestamp > CACHE_TTL) searchCache.delete(key);
      }
    }

    return NextResponse.json({ movies: results, query, total: results.length });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ movies: [], query: '', error: 'Search failed' }, { status: 500 });
  }
}
