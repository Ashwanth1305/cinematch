import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { deleteSession } from '@/lib/db';
import { getAuthenticatedUser, publicUser, SESSION_COOKIE } from '@/lib/serverAuth';

export async function GET() {
  const user = await getAuthenticatedUser();
  return NextResponse.json({ user: user ? publicUser(user) : null }, { status: user ? 200 : 401 });
}

export async function DELETE() {
  const cookieStore = await cookies();
  deleteSession(cookieStore.get(SESSION_COOKIE)?.value);
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return response;
}
