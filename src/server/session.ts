import { APP_ROLE, type DbScope } from '../db/scope.ts';
import { db } from './db.ts';

// The signed-in user and the database scope their requests run in.
//
// There is no sign-in yet: every request is the one local development user. Replacing
// currentUserId() with a real session lookup is the only change sign-in needs here,
// since every query below already runs as makabl_app under row-level security.

export const DEV_USER_EMAIL = 'dev@makabl.local';

/**
 * Provisioning runs as the login role: it creates the user that RLS will then check.
 * Not cached, so a reset database never leaves the server holding a deleted user's id.
 */
export async function currentUserId(): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `insert into users (email) values ($1)
     on conflict (email) do update set email = excluded.email
     returning id`,
    [DEV_USER_EMAIL],
  );
  return rows[0]!.id;
}

/** Scope for the current user's queries: the restricted role, filtered to their rows. */
export async function userScope(userId?: string): Promise<DbScope> {
  return { role: APP_ROLE, userId: userId ?? await currentUserId() };
}
