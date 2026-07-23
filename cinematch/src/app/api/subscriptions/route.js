import { NextResponse } from 'next/server';
import { authorizeUserId } from '@/lib/serverAuth';
import { getUserSubscriptions, setUserSubscriptions, getOttPlatforms } from '@/lib/db';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      // Return all available platforms
      return NextResponse.json({ platforms: getOttPlatforms() });
    }
    if (!await authorizeUserId(userId)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const subscriptions = getUserSubscriptions(userId);
    return NextResponse.json({ subscriptions });
  } catch (error) {
    console.error('Subscriptions GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { userId, platformIds } = body;

    if (!userId || !platformIds || !Array.isArray(platformIds)) {
      return NextResponse.json(
        { error: 'userId and platformIds[] are required' },
        { status: 400 }
      );
    }
    if (!await authorizeUserId(userId)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    setUserSubscriptions(userId, platformIds);
    const updated = getUserSubscriptions(userId);

    return NextResponse.json({
      success: true,
      subscriptions: updated
    });
  } catch (error) {
    console.error('Subscriptions POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
