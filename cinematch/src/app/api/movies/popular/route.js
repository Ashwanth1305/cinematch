import { NextResponse } from 'next/server';
import { getPopularForOnboarding, hasValidTmdbConfig } from '@/lib/tmdb';
import { getUserProviderIds } from '@/lib/db';

// Sample popular movies for fallback (when TMDB API key isn't configured)
const FALLBACK_MOVIES = [
  { id: 1, title: 'Inception', poster_path: '/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg', vote_average: 8.4, genre_ids: [28, 878, 53] },
  { id: 2, title: 'Interstellar', poster_path: '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg', vote_average: 8.7, genre_ids: [878, 18, 12] },
  { id: 3, title: 'The Dark Knight', poster_path: '/qJ2tW6WMUDux911r6m7haRef0WH.jpg', vote_average: 9.0, genre_ids: [28, 80, 18] },
  { id: 4, title: 'Oppenheimer', poster_path: '/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg', vote_average: 8.1, genre_ids: [18, 36] },
  { id: 5, title: 'Dune: Part Two', poster_path: '/8b8R8l88Qje9dn9OE8PY05Nez7E.jpg', vote_average: 8.2, genre_ids: [878, 12] },
  { id: 6, title: 'Spider-Man: No Way Home', poster_path: '/1g0dhYtq4irTY1GPXvft6k4YLjm.jpg', vote_average: 8.0, genre_ids: [28, 12, 878] },
  { id: 7, title: 'Parasite', poster_path: '/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg', vote_average: 8.5, genre_ids: [35, 53, 18] },
  { id: 8, title: 'The Shawshank Redemption', poster_path: '/9cjIGRiQagNMaGpP6VlVLlaIKnb.jpg', vote_average: 9.3, genre_ids: [18, 80] },
  { id: 9, title: 'Avengers: Endgame', poster_path: '/or06FN3Dka5tukK1e9SlFilteruj.jpg', vote_average: 8.3, genre_ids: [28, 12, 878] },
  { id: 10, title: 'Pulp Fiction', poster_path: '/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg', vote_average: 8.9, genre_ids: [53, 80] },
  { id: 11, title: 'Fight Club', poster_path: '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg', vote_average: 8.8, genre_ids: [18, 53] },
  { id: 12, title: 'Forrest Gump', poster_path: '/arw2vcBveWOVZr6pxd9XTd1TdQa.jpg', vote_average: 8.8, genre_ids: [35, 18, 10749] },
  { id: 13, title: 'The Matrix', poster_path: '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg', vote_average: 8.7, genre_ids: [28, 878] },
  { id: 14, title: 'Jawan', poster_path: '/jFwk94MNUkNOsVgxqlvWPqJcCGS.jpg', vote_average: 7.0, genre_ids: [28, 53, 18] },
  { id: 15, title: 'RRR', poster_path: '/nEufeZlyAOLqO2brrs0yeF1lgXN.jpg', vote_average: 7.8, genre_ids: [28, 18] },
  { id: 16, title: 'KGF: Chapter 2', poster_path: '/z57JlJhqfqPuAoJWaGWaAdVPOCx.jpg', vote_average: 7.5, genre_ids: [28, 18, 53] },
  { id: 17, title: 'Barbie', poster_path: '/iuFNMS8U5cb6xfzi51Dbkovj7vM.jpg', vote_average: 7.0, genre_ids: [35, 12] },
  { id: 18, title: 'Everything Everywhere All at Once', poster_path: '/w3LxiVQdWWRvLnF1kDNXyRkhybo.jpg', vote_average: 7.8, genre_ids: [28, 12, 878, 35] },
  { id: 19, title: 'Top Gun: Maverick', poster_path: '/62HCnUTziyWcpDaBO2i1DG1JbyV.jpg', vote_average: 8.3, genre_ids: [28, 18] },
  { id: 20, title: 'The Godfather', poster_path: '/3bhkrj58Vtu7enYsRolD1fZdja1.jpg', vote_average: 9.2, genre_ids: [18, 80] },
  { id: 21, title: 'Pathaan', poster_path: '/jygGZKN1E7FZIY1PYhQxPqMrIXn.jpg', vote_average: 6.5, genre_ids: [28, 53] },
  { id: 22, title: 'John Wick: Chapter 4', poster_path: '/vZloFAK7NmvMGKE7LsVlnw8UOE5.jpg', vote_average: 7.8, genre_ids: [28, 53, 80] },
  { id: 23, title: 'Joker', poster_path: '/udDclJoHjfjb8Ekgsd4FDteOkCU.jpg', vote_average: 8.2, genre_ids: [80, 53, 18] },
  { id: 24, title: 'Whiplash', poster_path: '/oPxnRhyAIzJKElMQxSIh3MRsByF.jpg', vote_average: 8.5, genre_ids: [18, 10402] },
  { id: 25, title: 'The Grand Budapest Hotel', poster_path: '/eWdyYQreja6JGCzqHWXpWHDrrPo.jpg', vote_average: 8.1, genre_ids: [35, 18] },
  { id: 26, title: 'Spirited Away', poster_path: '/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg', vote_average: 8.5, genre_ids: [16, 14, 12] },
  { id: 27, title: 'Get Out', poster_path: '/tFXcEccSQMf3lfhfXKSU9iRBpa3.jpg', vote_average: 7.6, genre_ids: [27, 53, 9648] },
  { id: 28, title: 'La La Land', poster_path: '/uDO8zWDhfWwoFdKS4fzkUJt0Rf0.jpg', vote_average: 7.9, genre_ids: [35, 18, 10749, 10402] },
  { id: 29, title: 'Dangal', poster_path: '/8hJMGOxcjpGpVqdDAkWm9CAJaSb.jpg', vote_average: 8.3, genre_ids: [28, 18] },
  { id: 30, title: '3 Idiots', poster_path: '/66A9MqXOyVFCssoloscw79z8Tew.jpg', vote_average: 8.2, genre_ids: [35, 18] }
];

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    let providerIds = [];
    if (userId) {
      providerIds = getUserProviderIds(userId);
    }

    // Try fetching from TMDB first when a real key is configured
    if (hasValidTmdbConfig()) {
      try {
        const tmdbMovies = await getPopularForOnboarding(providerIds);
        if (tmdbMovies.length > 0) {
          return NextResponse.json({ movies: tmdbMovies });
        }
      } catch (e) {
        console.warn('TMDB fetch failed, using fallback:', e.message);
      }
    }

    // Fallback to static data
    return NextResponse.json({ movies: FALLBACK_MOVIES });
  } catch (error) {
    console.error('Popular movies error:', error);
    return NextResponse.json({ movies: FALLBACK_MOVIES });
  }
}
