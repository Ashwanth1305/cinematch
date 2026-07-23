import { NextResponse } from 'next/server';
import { findUserByEmail, verifyPassword, createSession } from '@/lib/db';
import { publicUser, SESSION_COOKIE } from '@/lib/serverAuth';

export async function POST(request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const user = findUserByEmail(email);
    if (!user) {
      return NextResponse.json({ error: 'No account found with this email' }, { status: 404 });
    }

    if (!verifyPassword(user, password)) {
      return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
    }

    const session = createSession(user.id);
    const response = NextResponse.json({ user: publicUser(user) });
    response.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
      path: '/', expires: new Date(session.expires_at)
    });
    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
