import { NextResponse } from 'next/server';
import { authorizeUserId } from '@/lib/serverAuth';
import {
  submitFeedback,
  getPendingFeedbackMovies,
  dismissFeedback,
  getMovieById,
  resolveOrImportMovie,
  updateTasteProfile,
  getUserFeedback
} from '@/lib/db';

// POST — Submit feedback
export async function POST(request) {
  try {
    const { userId, movieId, watched, rating, likedAspects } = await request.json();

    if (!userId || !movieId || watched === undefined) {
      return NextResponse.json({ error: 'userId, movieId, and watched are required' }, { status: 400 });
    }
    if (!await authorizeUserId(userId)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (watched === true && (typeof rating !== 'number' || rating < 1 || rating > 10)) {
      return NextResponse.json({ error: 'A valid rating from 1 to 10 is required when watched is true' }, { status: 400 });
    }

    // Normalize movie ID and import TMDB movie data if needed
    const normalizedMovie = await resolveOrImportMovie(movieId);
    const feedbackMovieId = normalizedMovie?.id || movieId;

    // Submit feedback
    const feedback = submitFeedback(userId, feedbackMovieId, {
      watched,
      rating: watched ? rating : null,
      likedAspects: watched ? likedAspects : null
    });

    // Update taste profile based on feedback
    const movie = normalizedMovie || getMovieById(feedbackMovieId);
    updateTasteProfile(userId, { ...feedback, movie_id: feedbackMovieId }, movie);

    return NextResponse.json({ success: true, feedback });
  } catch (error) {
    console.error('Feedback submission error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET — Get pending feedback movies or user feedback history
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const type = searchParams.get('type'); // 'pending' or 'history'

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }
    if (!await authorizeUserId(userId)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (type === 'history') {
      const history = getUserFeedback(userId);
      return NextResponse.json({ feedback: history });
    }

    // Default: pending feedback
    const pending = getPendingFeedbackMovies(userId);
    return NextResponse.json({ pending });
  } catch (error) {
    console.error('Feedback fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH — Dismiss feedback for a movie
export async function PATCH(request) {
  try {
    const { userId, movieId } = await request.json();

    if (!userId || !movieId) {
      return NextResponse.json({ error: 'userId and movieId are required' }, { status: 400 });
    }
    if (!await authorizeUserId(userId)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    dismissFeedback(userId, movieId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Feedback dismiss error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
