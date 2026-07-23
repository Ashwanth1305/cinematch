import { NextResponse } from 'next/server';
import { authorizeUserId } from '@/lib/serverAuth';
import {
  addToWatchlist,
  getUserWatchlist,
  updateWatchlistStatus,
  getWatchlistMovieIds,
  logWatchEvent
} from '@/lib/db';

// GET — Get user's watchlist
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const status = searchParams.get('status'); // 'going_to_watch', 'watched', or null for all

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }
    if (!await authorizeUserId(userId)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const watchlist = getUserWatchlist(userId, status || null);
    const watchedIds = getWatchlistMovieIds(userId);

    return NextResponse.json({ watchlist, watchedIds });
  } catch (error) {
    console.error('Watchlist fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST — Add movie to watchlist
export async function POST(request) {
  try {
    const { userId, movieId, platformId } = await request.json();

    if (!userId || !movieId) {
      return NextResponse.json({ error: 'userId and movieId are required' }, { status: 400 });
    }
    if (!await authorizeUserId(userId)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const entry = addToWatchlist(userId, movieId);

    // Log which platform the user chose
    if (platformId) {
      logWatchEvent(userId, movieId, platformId);
    }

    return NextResponse.json({ success: true, entry });
  } catch (error) {
    console.error('Watchlist add error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH — Update watchlist status
export async function PATCH(request) {
  try {
    const { userId, movieId, status } = await request.json();

    if (!userId || !movieId || !status) {
      return NextResponse.json({ error: 'userId, movieId, and status are required' }, { status: 400 });
    }
    if (!await authorizeUserId(userId)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (!['going_to_watch', 'watched', 'skipped'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const updated = updateWatchlistStatus(userId, movieId, status);
    return NextResponse.json({ success: true, entry: updated });
  } catch (error) {
    console.error('Watchlist update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
