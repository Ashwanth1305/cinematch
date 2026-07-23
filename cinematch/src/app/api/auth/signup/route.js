import { NextResponse } from 'next/server';
import { createUser, findUserByEmail, createSession } from '@/lib/db';
import { publicUser, SESSION_COOKIE } from '@/lib/serverAuth';

export async function POST(request) {
  try {
    const { name, email, password } = await request.json();

    if (!name || !email || !password) {
      return NextResponse.json({ error: 'Name, email, and password are required' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    // Check if user exists
    const existing = findUserByEmail(email);
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });
    }

    const user = createUser({ email, password, name, authProvider: 'email' });

    const session = createSession(user.id);
    const response = NextResponse.json({ user: publicUser(user) }, { status: 201 });
    response.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
      path: '/', expires: new Date(session.expires_at)
    });
    return response;
  } catch (error) {
    console.error('Signup error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
