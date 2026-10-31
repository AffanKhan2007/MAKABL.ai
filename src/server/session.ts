import { cookies } from 'next/headers';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { endSession, sessionUser, type AuthResult, type SessionUser } from '../auth/accounts.ts';
import { APP_ROLE, type DbScope } from '../db/scope.ts';
import { db, DbUnavailableError, isDbUnavailable } from './db.ts';

// The signed-in user and the database scope their requests run in. Everything the app
// does for a user runs as makabl_app with app.user_id set, under row-level security.

export const SESSION_COOKIE = 'makabl_session';

/** Looked up once per request, however many components and queries ask. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  try {
    return await sessionUser(db(), token);
  } catch (err) {
    if (isDbUnavailable(err)) throw new DbUnavailableError();
    throw err;
  }
});

/** The signed-in user, or a redirect to the sign-in page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

export async function currentUserId(): Promise<string> {
  return (await requireUser()).id;
}

/** Scope for a user's queries: the restricted role, filtered to their rows. */
export async function userScope(userId?: string): Promise<DbScope> {
  return { role: APP_ROLE, userId: userId ?? await currentUserId() };
}

/** Set the session cookie after a successful sign-in or sign-up. */
export async function startSession(result: Extract<AuthResult, { ok: true }>): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: result.expiresAt,
  });
}

export async function signOutCurrent(): Promise<void> {
  const store = await cookies();
  await endSession(db(), store.get(SESSION_COOKIE)?.value);
  store.delete(SESSION_COOKIE);
}
