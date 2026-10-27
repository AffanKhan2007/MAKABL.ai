import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { dummyHash, hashPassword, normalizeEmail, passwordProblem, verifyPassword } from './password.ts';

// Accounts and sessions. Runs as the login role: it is the step that establishes who
// the user is, before anything can run as them under row-level security.

export const SESSION_DAYS = 30;
const MAX_FAILED_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
}

export type AuthResult =
  | { ok: true; user: SessionUser; token: string; expiresAt: Date }
  | { ok: false; error: string };

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Failed sign-ins per email in this process, to slow down password guessing. */
const failures = new Map<string, { count: number; resetAt: number }>();

function throttled(email: string, now = Date.now()): boolean {
  const f = failures.get(email);
  if (!f || f.resetAt < now) return false;
  return f.count >= MAX_FAILED_ATTEMPTS;
}

function recordFailure(email: string, now = Date.now()): void {
  const f = failures.get(email);
  if (!f || f.resetAt < now) failures.set(email, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
  else f.count++;
}

async function newSession(pool: pg.Pool, user: SessionUser): Promise<AuthResult> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    'insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)',
    [tokenHash(token), user.id, expiresAt],
  );
  return { ok: true, user, token, expiresAt };
}

export async function signUp(pool: pg.Pool, rawEmail: string, password: string): Promise<AuthResult> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, error: 'Enter a valid email address.' };
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };
  const hash = await hashPassword(password);
  const { rows } = await pool.query<{ id: string }>(
    'insert into users (email, password_hash) values ($1, $2) on conflict (email) do nothing returning id',
    [email, hash],
  );
  if (!rows[0]) return { ok: false, error: 'An account with this email already exists. Sign in instead.' };
  return newSession(pool, { id: rows[0].id, email });
}

const SIGN_IN_FAILED = 'Email or password is incorrect.';

export async function signIn(pool: pg.Pool, rawEmail: string, password: string): Promise<AuthResult> {
  const email = normalizeEmail(rawEmail);
  if (!email || password.length === 0 || password.length > 256) return { ok: false, error: SIGN_IN_FAILED };
  if (throttled(email)) return { ok: false, error: 'Too many attempts. Wait 15 minutes and try again.' };
  const { rows } = await pool.query<{ id: string; password_hash: string | null }>(
    'select id, password_hash from users where email = $1', [email]);
  const row = rows[0];
  // Verify against a dummy hash when there is no account, so timing does not reveal it.
  const ok = await verifyPassword(password, row?.password_hash ?? await dummyHash());
  if (!row?.password_hash || !ok) {
    recordFailure(email);
    return { ok: false, error: SIGN_IN_FAILED };
  }
  failures.delete(email);
  return newSession(pool, { id: row.id, email });
}

/** The user a session token belongs to, if it is valid and unexpired. */
export async function sessionUser(pool: pg.Pool, token: string | undefined): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  const { rows } = await pool.query<SessionUser>(
    `update sessions s set last_seen_at = now()
       from users u
      where s.token_hash = $1 and s.expires_at > now() and u.id = s.user_id
      returning u.id, u.email`,
    [tokenHash(token)],
  );
  return rows[0] ?? null;
}

export async function endSession(pool: pg.Pool, token: string | undefined): Promise<void> {
  if (token) await pool.query('delete from sessions where token_hash = $1', [tokenHash(token)]);
}
