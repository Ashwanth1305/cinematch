// Dynamic metadata for social sharing — fetches directly from TMDB for speed
import { getMovieDetails, getImageUrl } from '@/lib/tmdb';

export async function generateMetadata({ params }) {
  const { movieId } = await params;

  try {
    const details = await getMovieDetails(parseInt(movieId));

    if (!details) {
      return {
        title: 'Movie Recommendation — CineMatch',
        description: 'Discover movies tailored to your taste on CineMatch.',
      };
    }

    const imageUrl = details.backdrop_url
      ? `https://image.tmdb.org/t/p/w1280${details.backdrop_url}`
      : details.poster_url
        ? `https://image.tmdb.org/t/p/w500${details.poster_url}`
        : null;

    return {
      title: `${details.title} — CineMatch Recommendation`,
      description: details.overview || `⭐ ${details.imdb_rating?.toFixed(1)} IMDb`,
      openGraph: {
        title: `${details.title} — CineMatch Recommendation`,
        description: details.overview || `⭐ ${details.imdb_rating?.toFixed(1)} IMDb`,
        type: 'website',
        images: imageUrl ? [{ url: imageUrl, width: 1280, height: 720, alt: details.title }] : [],
      },
      twitter: {
        card: 'summary_large_image',
        title: `${details.title} — CineMatch`,
        description: details.overview || `⭐ ${details.imdb_rating?.toFixed(1)} IMDb`,
        images: imageUrl ? [imageUrl] : [],
      },
    };
  } catch {
    return {
      title: 'Movie Recommendation — CineMatch',
      description: 'Discover movies tailored to your taste on CineMatch.',
    };
  }
}

export default function ShareLayout({ children }) {
  return children;
}
