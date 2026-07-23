import { NextResponse } from 'next/server';
import { authorizeUserId } from '@/lib/serverAuth';
import { getTasteProfile, findUserById } from '@/lib/db';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }
    if (!await authorizeUserId(userId)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = findUserById(userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const profile = getTasteProfile(userId);

    // Calculate completeness percentage
    const feedbackCount = user.feedback_count || 0;
    const completeness = Math.min(100, Math.round((feedbackCount / 10) * 100));

    // Determine personalization level
    let level = 'none';
    let nextMilestone = 3;
    if (feedbackCount >= 10) { level = 'expert'; nextMilestone = null; }
    else if (feedbackCount >= 5) { level = 'advanced'; nextMilestone = 10; }
    else if (feedbackCount >= 3) { level = 'active'; nextMilestone = 5; }
    else if (feedbackCount >= 1) { level = 'beginner'; nextMilestone = 3; }

    // Get top genres
    const topGenres = profile?.genre_affinity
      ? Object.entries(profile.genre_affinity)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 3)
          .map(([genre, score]) => ({ genre, score: Math.round(score * 100) }))
      : [];

    // Get top aspects
    const aspects = profile ? [
      { name: 'Plot', weight: Math.round((profile.plot_weight || 0.2) * 100) },
      { name: 'Direction', weight: Math.round((profile.direction_weight || 0.2) * 100) },
      { name: 'Acting', weight: Math.round((profile.acting_weight || 0.2) * 100) },
      { name: 'VFX', weight: Math.round((profile.vfx_weight || 0.2) * 100) },
      { name: 'Music', weight: Math.round((profile.music_weight || 0.2) * 100) },
    ] : [];

    return NextResponse.json({
      profile: {
        completeness,
        level,
        feedbackCount,
        nextMilestone,
        topGenres,
        aspects,
        preferredDirectors: profile?.preferred_directors || [],
        preferredActors: profile?.preferred_actors || [],
        lastUpdated: profile?.last_updated
      }
    });
  } catch (error) {
    console.error('Taste profile error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
