import { NextResponse } from 'next/server';
import {
  getTrendingMovies,
  getUpcomingMovies,
  getMovieDetails,
  getMovieProviders,
  discoverByGenre,
  hasValidTmdbConfig,
} from '@/lib/tmdb';
import { getGenres, getUserProviderIds, rankMoviesForUser } from '@/lib/db';
import { authorizeUserId } from '@/lib/serverAuth';

// ============================================
// TMDB genre IDs
// ============================================
const GENRE_MAP = {
  action: 28, comedy: 35, horror: 27, thriller: 53,
  romance: 10749, drama: 18, 'sci-fi': 878, crime: 80,
  documentary: 99, animation: 16,
};

// ============================================
// In-memory cache with TTL
// ============================================
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) return entry.data;
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

// ============================================
// Fallback sample data (used when TMDB is unreachable)
// ============================================
const SAMPLE_MOVIES = [
  { id: 101, tmdb_id: 101, title: 'Oppenheimer', overview: 'The story of J. Robert Oppenheimer and the creation of the atomic bomb.', poster_url: '/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg', backdrop_url: '/fm6KqXpk3M2HVveHwCrBSSBaO0V.jpg', imdb_rating: 8.1, content_type: 'movie', release_date: '2023-07-21', director: 'Christopher Nolan', cast_members: ['Cillian Murphy', 'Emily Blunt', 'Matt Damon', 'Robert Downey Jr.'], genres: ['drama', 'thriller'], platforms: [{ id: 119, name: 'Prime Video', logo: '' }] },
  { id: 102, tmdb_id: 102, title: 'The Shawshank Redemption', overview: 'A banker sentenced to life in prison forms a bond with a fellow inmate.', poster_url: '/9cjIGRiQagNMaGpP6VlVLlaIKnb.jpg', backdrop_url: '/kXfqcdQKsToO0OUXHcrrNCHDBzO.jpg', imdb_rating: 9.3, content_type: 'movie', release_date: '1994-09-23', director: 'Frank Darabont', cast_members: ['Tim Robbins', 'Morgan Freeman', 'Bob Gunton', 'William Sadler'], genres: ['drama', 'crime'], platforms: [{ id: 8, name: 'Netflix', logo: '' }, { id: 119, name: 'Prime Video', logo: '' }] },
  { id: 103, tmdb_id: 103, title: 'The Godfather', overview: 'The aging patriarch of an organized crime dynasty transfers control to his reluctant son.', poster_url: '/3bhkrj58Vtu7enYsRolD1fZdja1.jpg', backdrop_url: '/tmU7GeKVybMWFButWEGl2M4GeiP.jpg', imdb_rating: 9.2, content_type: 'movie', release_date: '1972-03-14', director: 'Francis Ford Coppola', cast_members: ['Marlon Brando', 'Al Pacino', 'James Caan', 'Diane Keaton'], genres: ['drama', 'crime'], platforms: [{ id: 119, name: 'Prime Video', logo: '' }] },
  { id: 201, tmdb_id: 201, title: 'Avengers: Infinity War', overview: 'The Avengers must stop Thanos from collecting all six Infinity Stones.', poster_url: '/7WsyChQLEftFiDhRkfUP2AikFss.jpg', backdrop_url: '/lmZFxXgJE3vgrciwuDib0N8CfQo.jpg', imdb_rating: 8.4, content_type: 'movie', release_date: '2018-04-25', director: 'Anthony Russo', cast_members: ['Robert Downey Jr.', 'Chris Hemsworth', 'Mark Ruffalo', 'Chris Evans'], genres: ['action', 'sci-fi'], platforms: [{ id: 122, name: 'Hotstar', logo: '' }] },
  { id: 202, tmdb_id: 202, title: 'Spider-Man: Across the Spider-Verse', overview: 'Miles Morales catapults across the multiverse, meeting a team of Spider-People.', poster_url: '/8Vt6mWEReuy60MxNp7HKFyZFhZu.jpg', backdrop_url: '/4HodYYKEIsGOdinkGi2Ucz6X9i0.jpg', imdb_rating: 8.6, content_type: 'movie', release_date: '2023-05-31', director: 'Joaquim Dos Santos', cast_members: ['Shameik Moore', 'Hailee Steinfeld', 'Oscar Isaac'], genres: ['action', 'animation'], platforms: [{ id: 8, name: 'Netflix', logo: '' }] },
  { id: 203, tmdb_id: 203, title: 'The Dark Knight', overview: 'Batman must accept one of the greatest tests to fight injustice.', poster_url: '/qJ2tW6WMUDux911r6m7haRef0WH.jpg', backdrop_url: '/nMKdUUepR0i5zn0y1T4CsSB5ez9.jpg', imdb_rating: 9.0, content_type: 'movie', release_date: '2008-07-16', director: 'Christopher Nolan', cast_members: ['Christian Bale', 'Heath Ledger', 'Aaron Eckhart', 'Michael Caine'], genres: ['action', 'crime', 'drama'], platforms: [{ id: 119, name: 'Prime Video', logo: '' }] },
  { id: 301, tmdb_id: 301, title: 'Get Out', overview: 'A young African-American visits his white girlfriend\'s parents for the weekend.', poster_url: '/tFXcEccSQMf3lfhfXKSU9iRBpa3.jpg', backdrop_url: '/wSMdJmkr7pBOsmATh2PqxW9gR0u.jpg', imdb_rating: 7.6, content_type: 'movie', release_date: '2017-02-24', director: 'Jordan Peele', cast_members: ['Daniel Kaluuya', 'Allison Williams', 'Bradley Whitford'], genres: ['horror', 'thriller'], platforms: [{ id: 8, name: 'Netflix', logo: '' }] },
  { id: 302, tmdb_id: 302, title: 'A Quiet Place', overview: 'A family must live in silence to avoid mysterious creatures that hunt by sound.', poster_url: '/nAU74GmpUk7t5iklEp3bufwDq4n.jpg', backdrop_url: '/roYyPiQDQKmIKUEhO2f8SRjiaEd.jpg', imdb_rating: 7.5, content_type: 'movie', release_date: '2018-04-03', director: 'John Krasinski', cast_members: ['Emily Blunt', 'John Krasinski', 'Millicent Simmonds'], genres: ['horror', 'thriller'], platforms: [{ id: 119, name: 'Prime Video', logo: '' }] },
  { id: 401, tmdb_id: 401, title: 'Inception', overview: 'A thief who steals corporate secrets through dream-sharing technology.', poster_url: '/xlaY2zyzMfkhk0HSC5VUwzoZPU1.jpg', backdrop_url: '/8ZTVqvKDQ8emSGUEMjsS4yHAwrp.jpg', imdb_rating: 8.4, content_type: 'movie', release_date: '2010-07-16', director: 'Christopher Nolan', cast_members: ['Leonardo DiCaprio', 'Joseph Gordon-Levitt', 'Elliot Page', 'Tom Hardy'], genres: ['thriller', 'sci-fi', 'action'], platforms: [{ id: 8, name: 'Netflix', logo: '' }, { id: 119, name: 'Prime Video', logo: '' }] },
  { id: 402, tmdb_id: 402, title: 'Gone Girl', overview: 'A man finds himself the main suspect in the disappearance of his wife.', poster_url: '/lv5xShBIDPe6syEsMFkHf0oUJOJ.jpg', backdrop_url: '/gKMrJKd7MBNrvRxFSnMjFmitZwj.jpg', imdb_rating: 8.1, content_type: 'movie', release_date: '2014-10-01', director: 'David Fincher', cast_members: ['Ben Affleck', 'Rosamund Pike', 'Neil Patrick Harris'], genres: ['thriller', 'drama'], platforms: [{ id: 119, name: 'Prime Video', logo: '' }] },
  { id: 501, tmdb_id: 501, title: 'La La Land', overview: 'A jazz musician and an aspiring actress fall in love in Los Angeles.', poster_url: '/uDO8zWDhfWwoFdKS4fzkUJt0Rf0.jpg', backdrop_url: '/p6h1gJlAZaKaImU10xd7Lz9VQb3.jpg', imdb_rating: 7.9, content_type: 'movie', release_date: '2016-11-29', director: 'Damien Chazelle', cast_members: ['Ryan Gosling', 'Emma Stone', 'John Legend'], genres: ['romance', 'comedy', 'drama'], platforms: [{ id: 8, name: 'Netflix', logo: '' }] },
  { id: 502, tmdb_id: 502, title: 'The Notebook', overview: 'A young couple falls in love during the early years of WWII.', poster_url: '/rNzQyW4f8B8cQeg7Dgj3n6eT5k9.jpg', backdrop_url: '/qom1SZSENdmHFNZBXbtJAU0WTlC.jpg', imdb_rating: 7.8, content_type: 'movie', release_date: '2004-06-25', director: 'Nick Cassavetes', cast_members: ['Ryan Gosling', 'Rachel McAdams', 'James Garner'], genres: ['romance', 'drama'], platforms: [{ id: 8, name: 'Netflix', logo: '' }, { id: 119, name: 'Prime Video', logo: '' }] },
  { id: 601, tmdb_id: 601, title: 'Parasite', overview: 'Greed and class discrimination threaten a symbiotic relationship between the wealthy Park family and the destitute Kim clan.', poster_url: '/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg', backdrop_url: '/TU9NIjwzjoKPwQHoHshkFcQUCG8.jpg', imdb_rating: 8.5, content_type: 'movie', release_date: '2019-05-30', director: 'Bong Joon-ho', cast_members: ['Song Kang-ho', 'Lee Sun-kyun', 'Cho Yeo-jeong', 'Choi Woo-shik'], genres: ['drama', 'comedy', 'thriller'], platforms: [{ id: 119, name: 'Prime Video', logo: '' }] },
  { id: 602, tmdb_id: 602, title: 'Forrest Gump', overview: 'The story of a man with a low IQ who accomplishes great things in his life.', poster_url: '/arw2vcBveWOVZr6pxd9XTd1TdQa.jpg', backdrop_url: '/7c9UVPPiTPltouxRVY6N9uugaVA.jpg', imdb_rating: 8.8, content_type: 'movie', release_date: '1994-06-23', director: 'Robert Zemeckis', cast_members: ['Tom Hanks', 'Robin Wright', 'Gary Sinise'], genres: ['drama', 'comedy', 'romance'], platforms: [{ id: 8, name: 'Netflix', logo: '' }, { id: 119, name: 'Prime Video', logo: '' }] },
  { id: 701, tmdb_id: 701, title: 'Interstellar', overview: 'A team of explorers travel through a wormhole in space to ensure humanity\'s survival.', poster_url: '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg', backdrop_url: '/xJHokMbljvjADYdit5fK1DVfjko.jpg', imdb_rating: 8.7, content_type: 'movie', release_date: '2014-11-05', director: 'Christopher Nolan', cast_members: ['Matthew McConaughey', 'Anne Hathaway', 'Jessica Chastain', 'Michael Caine'], genres: ['sci-fi', 'drama'], platforms: [{ id: 119, name: 'Prime Video', logo: '' }] },
  { id: 702, tmdb_id: 702, title: 'The Matrix', overview: 'A hacker discovers the world is a computer simulation and joins a rebellion.', poster_url: '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg', backdrop_url: '/fNG7i7RqMErkcqhohV2a6cV1Ehy.jpg', imdb_rating: 8.7, content_type: 'movie', release_date: '1999-03-30', director: 'Lana Wachowski', cast_members: ['Keanu Reeves', 'Laurence Fishburne', 'Carrie-Anne Moss'], genres: ['sci-fi', 'action'], platforms: [{ id: 8, name: 'Netflix', logo: '' }] },
  { id: 801, tmdb_id: 801, title: 'Pulp Fiction', overview: 'The lives of two mob hitmen, a boxer, and a pair of diner bandits intertwine.', poster_url: '/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg', backdrop_url: '/suaEOtk1N1sgg2MTM7oZd2cfVp3.jpg', imdb_rating: 8.9, content_type: 'movie', release_date: '1994-09-10', director: 'Quentin Tarantino', cast_members: ['John Travolta', 'Uma Thurman', 'Samuel L. Jackson', 'Bruce Willis'], genres: ['crime', 'thriller'], platforms: [{ id: 119, name: 'Prime Video', logo: '' }] },
  { id: 802, tmdb_id: 802, title: 'The Departed', overview: 'An undercover cop and a mole in the police try to identify each other.', poster_url: '/nT97ifVT2J1yMQmeq20Qblg61T.jpg', backdrop_url: '/8qHsuMM5xJfCZNstLaL40R7bMuM.jpg', imdb_rating: 8.5, content_type: 'movie', release_date: '2006-10-05', director: 'Martin Scorsese', cast_members: ['Leonardo DiCaprio', 'Matt Damon', 'Jack Nicholson', 'Mark Wahlberg'], genres: ['crime', 'drama', 'thriller'], platforms: [{ id: 8, name: 'Netflix', logo: '' }] },
  { id: 204, tmdb_id: 204, title: 'John Wick: Chapter 4', overview: 'John Wick discovers a path to defeating The High Table.', poster_url: '/vZloFAK7NmvMGKE7LsVlnw8UOE5.jpg', backdrop_url: '/7I6VUdPj6tQECNHdviJkUHD2u89.jpg', imdb_rating: 7.8, content_type: 'movie', release_date: '2023-03-22', director: 'Chad Stahelski', cast_members: ['Keanu Reeves', 'Donnie Yen', 'Bill Skarsgård', 'Laurence Fishburne'], genres: ['action', 'thriller', 'crime'], platforms: [{ id: 119, name: 'Prime Video', logo: '' }] },
  { id: 205, tmdb_id: 205, title: 'Godzilla Minus One', overview: 'Post-war Japan faces a new threat in the form of Godzilla.', poster_url: '/hkxxMIGaiCTmrEArK7J56JTKUlB.jpg', backdrop_url: '/fY3lD0jM5AoHJMunjGWqJ0hRk3l.jpg', imdb_rating: 7.6, content_type: 'movie', release_date: '2023-11-03', director: 'Takashi Yamazaki', cast_members: ['Ryunosuke Kamiki', 'Minami Hamabe'], genres: ['action', 'sci-fi'], platforms: [{ id: 8, name: 'Netflix', logo: '' }] },
  { id: 206, tmdb_id: 206, title: 'Extraction 2', overview: 'Tyler Rake returns for another impossible mission.', poster_url: '/7gKI9hpEMcZUQpNgKrkDzJpbnNS.jpg', backdrop_url: '/qVH2zHIaGPOQu3Evjts0VZkGkCr.jpg', imdb_rating: 7.3, content_type: 'movie', release_date: '2023-06-16', director: 'Sam Hargrave', cast_members: ['Chris Hemsworth', 'Golshifteh Farahani', 'Idris Elba'], genres: ['action', 'thriller'], platforms: [{ id: 8, name: 'Netflix', logo: '' }] },
  { id: 303, tmdb_id: 303, title: 'Hereditary', overview: 'A grieving family is haunted by tragic and disturbing occurrences.', poster_url: '/p9fmuz2Oj3E2Jn1sLT8S6QkpU80.jpg', backdrop_url: '/5GCvvg5kkCLFCnk9zzTFQ7R8e43.jpg', imdb_rating: 7.3, content_type: 'movie', release_date: '2018-06-07', director: 'Ari Aster', cast_members: ['Toni Collette', 'Milly Shapiro', 'Gabriel Byrne', 'Alex Wolff'], genres: ['horror', 'drama'], platforms: [{ id: 119, name: 'Prime Video', logo: '' }] },
  { id: 403, tmdb_id: 403, title: 'Shutter Island', overview: 'Two U.S. Marshals investigate the disappearance of a patient from a mental institution.', poster_url: '/kve20tXMHzp9of2iSaT49zIFnHs.jpg', backdrop_url: '/avedvodAYUkVJOLzCGofEjVg7wj.jpg', imdb_rating: 8.2, content_type: 'movie', release_date: '2010-02-18', director: 'Martin Scorsese', cast_members: ['Leonardo DiCaprio', 'Mark Ruffalo', 'Ben Kingsley'], genres: ['thriller', 'drama'], platforms: [{ id: 8, name: 'Netflix', logo: '' }] },
  { id: 503, tmdb_id: 503, title: '500 Days of Summer', overview: 'A romantic comedy about a man reflecting on a failed relationship.', poster_url: '/f9mbM0YMLpYemcWx6o2WeiYQLDP.jpg', backdrop_url: '/cGeXQDOCfVfD3mVNB4dXiLXEBv8.jpg', imdb_rating: 7.7, content_type: 'movie', release_date: '2009-07-17', director: 'Marc Webb', cast_members: ['Joseph Gordon-Levitt', 'Zooey Deschanel'], genres: ['romance', 'comedy', 'drama'], platforms: [{ id: 119, name: 'Prime Video', logo: '' }] },
  { id: 603, tmdb_id: 603, title: 'The Grand Budapest Hotel', overview: 'A legendary concierge at a famous hotel and his protégé.', poster_url: '/eWdyYQreja6JGCzqHWXpWHDrrPo.jpg', backdrop_url: '/nX5XotM9yprCKarRH4fzOq1VM1J.jpg', imdb_rating: 8.1, content_type: 'movie', release_date: '2014-02-26', director: 'Wes Anderson', cast_members: ['Ralph Fiennes', 'F. Murray Abraham', 'Tony Revolori'], genres: ['drama', 'comedy'], platforms: [{ id: 122, name: 'Hotstar', logo: '' }] },
  { id: 703, tmdb_id: 703, title: 'Dune: Part Two', overview: 'Paul Atreides unites with the Fremen to take on the Harkonnens.', poster_url: '/8b8R8l88Qje9dn9OE8PY05Nez7E.jpg', backdrop_url: '/xOMo8BRK7PfcJv9JCnx7s5hj0PX.jpg', imdb_rating: 8.2, content_type: 'movie', release_date: '2024-02-27', director: 'Denis Villeneuve', cast_members: ['Timothée Chalamet', 'Zendaya', 'Austin Butler', 'Florence Pugh'], genres: ['sci-fi', 'action'], platforms: [{ id: 119, name: 'Prime Video', logo: '' }] },
];

function getSampleMoviesByGenre(genre) {
  return SAMPLE_MOVIES.filter(m => m.genres.includes(genre))
    .sort((a, b) => b.imdb_rating - a.imdb_rating);
}

function getSampleTrending() {
  return [...SAMPLE_MOVIES].sort((a, b) => b.imdb_rating - a.imdb_rating).slice(0, 15);
}

// ============================================
// TMDB transformers
// ============================================
function transformTMDBMovie(tmdbMovie, providers = []) {
  return {
    id: tmdbMovie.id,
    tmdb_id: tmdbMovie.id,
    title: tmdbMovie.title || tmdbMovie.name,
    overview: tmdbMovie.overview,
    poster_url: tmdbMovie.poster_path,
    backdrop_url: tmdbMovie.backdrop_path,
    imdb_rating: Math.round((tmdbMovie.vote_average || 0) * 10) / 10,
    content_type: tmdbMovie.media_type === 'tv' ? 'series' : 'movie',
    release_date: tmdbMovie.release_date || tmdbMovie.first_air_date,
    director: tmdbMovie.director || null,
    cast_members: tmdbMovie.cast || [],
    genres: (tmdbMovie.genre_ids || []).map(gid => {
      const slug = Object.entries(GENRE_MAP).find(([, id]) => id === gid)?.[0];
      return slug || 'other';
    }).filter(g => g !== 'other'),
    platforms: providers
  };
}

async function enrichWithProviders(movies, concurrency = 3) {
  const results = [];
  for (let i = 0; i < movies.length; i += concurrency) {
    const batch = movies.slice(i, i + concurrency);
    const enriched = await Promise.all(
      batch.map(async (movie) => {
        try {
          const providers = await getMovieProviders(movie.id);
          return transformTMDBMovie(movie, providers);
        } catch {
          return transformTMDBMovie(movie, []);
        }
      })
    );
    results.push(...enriched);
  }
  return results;
}

async function getFullMovieDetails(movieId) {
  const cacheKey = `movie_detail_${movieId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // Check fallback sample data first
  const sample = SAMPLE_MOVIES.find(m => m.id === movieId);

  try {
    const [details, providers] = await Promise.all([
      getMovieDetails(movieId),
      getMovieProviders(movieId)
    ]);

    const movie = {
      id: details.tmdb_id,
      tmdb_id: details.tmdb_id,
      title: details.title,
      overview: details.overview,
      poster_url: details.poster_url,
      backdrop_url: details.backdrop_url,
      imdb_rating: Math.round((details.imdb_rating || 0) * 10) / 10,
      content_type: details.content_type,
      release_date: details.release_date,
      director: details.director,
      cast_members: details.cast,
      genres: (details.genres || []).map(g => {
        const slug = Object.entries(GENRE_MAP).find(([, id]) => id === g.id)?.[0];
        return slug || g.name?.toLowerCase() || 'other';
      }),
      platforms: providers,
      runtime: details.runtime,
      keywords: details.keywords
    };

    setCache(cacheKey, movie);
    return movie;
  } catch (error) {
    console.warn(`TMDB fetch failed for movie ${movieId}, using fallback:`, error.message);
    // Return sample data if available
    if (sample) return sample;
    return null;
  }
}

// ============================================
// GET handler
// ============================================
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const genre = searchParams.get('genre');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const type = searchParams.get('type');
    const movieId = searchParams.get('id');
    const userId = searchParams.get('userId');

    if (userId && !await authorizeUserId(userId)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ─── Single movie detail ───
    if (movieId) {
      const movie = await getFullMovieDetails(parseInt(movieId));
      if (!movie) {
        return NextResponse.json({ error: 'Movie not found' }, { status: 404 });
      }
      return NextResponse.json({ movie });
    }

    // ─── Trending ───
    if (type === 'trending') {
      const cacheKey = 'trending_movies';
      let trending = getCached(cacheKey);

      if (!trending) {
        if (hasValidTmdbConfig()) {
          try {
            const raw = await getTrendingMovies(1);
            trending = await enrichWithProviders(raw.slice(0, 15), 3);
          } catch (err) {
            console.warn('TMDB trending failed, using fallback:', err.message);
            trending = getSampleTrending();
          }
        } else {
          trending = getSampleTrending();
        }
        setCache(cacheKey, trending);
      }

      // Filter by user's subscriptions if userId provided
      if (userId) {
        try {
          const providerIds = getUserProviderIds(userId);
          if (providerIds.length > 0) {
            const filtered = trending.filter(m =>
              m.platforms.some(p => providerIds.includes(p.id))
            );
            if (filtered.length >= 3) trending = filtered;
          }
        } catch {}
      }

      return NextResponse.json({ movies: trending });
    }

    // ─── Coming Soon ───
    if (type === 'coming_soon') {
      const cacheKey = 'coming_soon';
      let comingSoon = getCached(cacheKey);

      if (!comingSoon) {
        if (hasValidTmdbConfig()) {
          try {
            const raw = await getUpcomingMovies(1);
            const upcoming = raw
              .filter(m => new Date(m.release_date) > new Date())
              .slice(0, 6);
            comingSoon = await enrichWithProviders(upcoming, 3);
            comingSoon = comingSoon.map(m => ({ ...m, coming_date: m.release_date }));
          } catch (err) {
            console.warn('TMDB upcoming failed, using fallback:', err.message);
            comingSoon = [];
          }
        } else {
          comingSoon = [];
        }
        setCache(cacheKey, comingSoon);
      }

      return NextResponse.json({ movies: comingSoon });
    }

    // ─── Leaving Soon ───
    if (type === 'leaving_soon') {
      return NextResponse.json({ movies: [] });
    }

    // ─── By genre ───
    if (genre && GENRE_MAP[genre]) {
      const tmdbGenreId = GENRE_MAP[genre];
      const cacheKey = `genre_${genre}_p${page}`;
      let genreMovies = getCached(cacheKey);

      if (!genreMovies) {
        if (hasValidTmdbConfig()) {
          try {
            let providerIds = [];
            if (userId) providerIds = getUserProviderIds(userId);
            const raw = await discoverByGenre(tmdbGenreId, providerIds, page);
            genreMovies = await enrichWithProviders(raw.slice(0, limit), 3);
            genreMovies.sort((a, b) => b.imdb_rating - a.imdb_rating);
          } catch (err) {
            console.warn(`TMDB genre ${genre} failed, using fallback:`, err.message);
            genreMovies = getSampleMoviesByGenre(genre);
          }
        } else {
          genreMovies = getSampleMoviesByGenre(genre);
        }
        setCache(cacheKey, genreMovies);
      }

      const rankedGenreMovies = userId
        ? rankMoviesForUser(userId, genreMovies)
        : genreMovies;

      return NextResponse.json({
        movies: rankedGenreMovies,
        total: genreMovies.length,
        page,
        hasMore: genreMovies.length >= limit
      });
    }

    // ─── All genres (homepage) ───
    const cacheKey = `all_genres_${userId || 'anon'}`;
    let genresData = getCached(cacheKey);

    if (!genresData) {
      let providerIds = [];
      if (userId) {
        try { providerIds = getUserProviderIds(userId); } catch {}
      }

      const genreSlugs = ['action', 'comedy', 'horror', 'thriller', 'romance', 'drama', 'sci-fi', 'crime'];
      genresData = {};

      // Fetch genres in parallel (2 at a time)
      for (let i = 0; i < genreSlugs.length; i += 2) {
        const batch = genreSlugs.slice(i, i + 2);
        const results = await Promise.all(
          batch.map(async (slug) => {
            if (hasValidTmdbConfig()) {
              try {
                const raw = await discoverByGenre(GENRE_MAP[slug], providerIds, 1);
                const movies = await enrichWithProviders(raw.slice(0, 10), 3);
                movies.sort((a, b) => b.imdb_rating - a.imdb_rating);
                return { slug, movies };
              } catch (err) {
                console.warn(`TMDB genre ${slug} failed, using fallback:`, err.message);
                return { slug, movies: getSampleMoviesByGenre(slug) };
              }
            }
            return { slug, movies: getSampleMoviesByGenre(slug) };
          })
        );
        results.forEach(({ slug, movies }) => {
          genresData[slug] = movies;
        });
      }

      setCache(cacheKey, genresData);
    }

    const personalizedGenres = userId
      ? Object.fromEntries(
          Object.entries(genresData).map(([slug, genreMovies]) => [
            slug,
            rankMoviesForUser(userId, genreMovies),
          ])
        )
      : genresData;

    return NextResponse.json({ genres: personalizedGenres });
  } catch (error) {
    console.error('Movies API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
