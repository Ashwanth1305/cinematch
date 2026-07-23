import { NextResponse } from 'next/server';

// Fetch movie data for the share page
async function getMovieById(id) {
  try {
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/movies?id=${id}`);
    const data = await res.json();
    return data.movie || null;
  } catch {
    return null;
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const movieId = searchParams.get('movieId');
    const userId = searchParams.get('userId');
    const message = searchParams.get('message') || '';

    if (!movieId) {
      return NextResponse.json({ error: 'movieId is required' }, { status: 400 });
    }

    const movie = await getMovieById(movieId);
    if (!movie) {
      return NextResponse.json({ error: 'Movie not found' }, { status: 404 });
    }

    // Generate share data
    const shareUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/share/${movieId}`;
    const shareText = message || `Check out "${movie.title}" on CineMatch! ⭐ ${movie.imdb_rating?.toFixed(1)} IMDb`;

    const shareData = {
      movie,
      shareUrl,
      shareText,
      shareLinks: {
        whatsapp: `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${shareUrl}`)}`,
        twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`,
        telegram: `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`,
        copy: shareUrl
      },
      ogMeta: {
        title: `${movie.title} — CineMatch Recommendation`,
        description: movie.overview || `Watch ${movie.title} on your streaming platforms. ⭐ ${movie.imdb_rating?.toFixed(1)} IMDb`,
        image: movie.backdrop_url
          ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_url}`
          : (movie.poster_url ? `https://image.tmdb.org/t/p/w500${movie.poster_url}` : null)
      }
    };

    return NextResponse.json(shareData);
  } catch (error) {
    console.error('Share API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
