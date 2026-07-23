import { cookies } from 'next/headers';
import { findSession, findUserById } from '@/lib/db';

export const SESSION_COOKIE = 'cinematch_session';

export async function getAuthenticatedUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = findSession(token);
  return session ? findUserById(session.user_id) : null;
}

export async function authorizeUserId(requestedUserId) {
  const user = await getAuthenticatedUser();
  if (!user || (requestedUserId && user.id !== requestedUserId)) return null;
  return user;
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    auth_provider: user.auth_provider,
    feedback_count: user.feedback_count,
    onboarding_completed: user.onboarding_completed
  };
}
