import { NextResponse } from 'next/server';
import { authorizeUserId } from '@/lib/serverAuth';
import { getMovieDetails, getMovieProviders } from '@/lib/tmdb';
import {
  updateUser,
  createTasteProfile,
  addToWatchlist,
  updateWatchlistStatus,
  updateTasteProfile,
  upsertMovie,
  setMovieGenres,
  setMovieAvailability,
  getMovieById,
  getMovieByTmdbId,
  GENRES,
  TMDB_GENRE_MAP
} from '@/lib/db';

export async function POST(request) {
  try {
    const { userId, movieIds } = await request.json();

    if (!userId || !movieIds || movieIds.length !== 5) {
      return NextResponse.json({ error: 'User ID and exactly 5 movie IDs required' }, { status: 400 });
    }
    if (!await authorizeUserId(userId)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const selectedMovies = [];

    // For each selected movie, resolve its local ID (fetching details from TMDB if not in DB yet)
    for (const id of movieIds) {
      const numericId = parseInt(id);
      let localId = numericId;

      // Check if movie already exists locally
      let movie = getMovieById(numericId) || getMovieByTmdbId(numericId);
      
      if (!movie && process.env.TMDB_API_KEY && process.env.TMDB_API_KEY !== 'demo_key') {
        // Fetch from TMDB and upsert
        try {
          const movieData = await getMovieDetails(numericId);
          const providers = await getMovieProviders(numericId);
          const platforms = providers.map(p => ({ id: p.id, name: p.name }));
          
          const dbMovieData = {
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
            platforms: platforms
          };
          
          const savedMovie = upsertMovie(dbMovieData);
          const localGenreIds = (movieData.genres || []).map(g => TMDB_GENRE_MAP[g.id]).filter(Boolean);
          setMovieGenres(savedMovie.id, localGenreIds);
          
          const availabilityPlatforms = platforms.map(p => ({
            ott_platform_id: p.id,
            availability_type: 'streaming'
          }));
          setMovieAvailability(savedMovie.id, availabilityPlatforms);
          
          localId = savedMovie.id;
        } catch (err) {
          console.error(`Failed to import TMDB movie ${numericId} on onboarding complete:`, err);
        }
      } else if (movie) {
        localId = movie.id;
      }

      // Add to watchlist as watched
      addToWatchlist(userId, localId);
      updateWatchlistStatus(userId, localId, 'watched');

      const resolvedMovie = getMovieById(localId);
      if (resolvedMovie) selectedMovies.push(resolvedMovie);
    }

    // Create initial taste profile
    const genreAffinity = {};
    GENRES.forEach(g => {
      genreAffinity[g.slug] = 0.5; // Start neutral
    });

    createTasteProfile(userId, {
      genre_affinity: genreAffinity,
      preferred_directors: [],
      preferred_actors: []
    });

    // Treat the five explicitly loved movies as strong positive preference
    // signals without increasing the post-onboarding feedback counter.
    selectedMovies.forEach(movie => {
      updateTasteProfile(userId, {
        movie_id: movie.id,
        watched: true,
        rating: 9,
        liked_aspects: []
      }, movie);
    });

    // Mark onboarding as completed
    updateUser(userId, { onboarding_completed: true });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Onboarding complete error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
