import { NextResponse } from 'next/server';
import { authorizeUserId } from '@/lib/serverAuth';
import { getPersonalizedRecommendations, getMLEnhancedRecommendations, getUserProviderIds } from '@/lib/db';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const limit = parseInt(searchParams.get('limit') || '8', 10);
    const useML = searchParams.get('ml') !== 'false'; // opt-out with ?ml=false

    if (!userId) {
      return NextResponse.json({ movies: [] });
    }
    if (!await authorizeUserId(userId)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const providerIds = getUserProviderIds(userId);
    let movies;
    let mlUsed = false;

    if (useML) {
      // Try ML-enhanced recommendations (async, with fallback)
      try {
        movies = await getMLEnhancedRecommendations(userId, {
          limit,
          platformIds: providerIds,
          excludeMovieIds: [],
        });
        mlUsed = movies.length > 0;
      } catch (err) {
        console.warn('[Recommendations API] ML recommendations failed:', err.message);
      }
    }

    // Fallback to pure rule-based if ML didn't produce results
    if (!movies || movies.length === 0) {
      movies = getPersonalizedRecommendations(userId, {
        limit,
        platformIds: providerIds,
        excludeMovieIds: [],
      });
    }

    return NextResponse.json({
      movies,
      meta: { ml_used: mlUsed },
    });
  } catch (error) {
    console.error('Recommendations API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
