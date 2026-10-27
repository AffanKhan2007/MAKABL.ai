// Create (or reset the password of) a local development account. Local databases only.
//
//   node scripts/seed-dev-user.ts
//
// Sign in with DEV_USER_EMAIL / DEV_USER_PASSWORD from the environment, or the defaults
// below. They are for a local development database only, never for a deployed one.

import pg from 'pg';
import { hashPassword, normalizeEmail, passwordProblem } from '../src/auth/password.ts';

const url = process.env.DATABASE_URL ?? 'postgres://postgres:makabl@localhost:5433/makabl';
if (!['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname)) {
  throw new Error('refusing to seed a development account into a non-local database');
}

const email = normalizeEmail(process.env.DEV_USER_EMAIL ?? 'dev@makabl.local');
const password = process.env.DEV_USER_PASSWORD ?? 'local-dev-password';
if (!email) throw new Error('DEV_USER_EMAIL is not a valid email');
const problem = passwordProblem(password);
if (problem) throw new Error(`DEV_USER_PASSWORD: ${problem}`);

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(
    `insert into users (email, password_hash) values ($1, $2)
     on conflict (email) do update set password_hash = excluded.password_hash`,
    [email, await hashPassword(password)],
  );
  console.log(`development account ready: ${email}`);
} finally {
  await client.end();
}
