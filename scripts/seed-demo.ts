// Create (or reuse) a demo account with one fresh project that is ready to price and build.
// Local databases only, safe to run repeatedly:
//
//   node scripts/seed-demo.ts
//
// Sign in with DEMO_EMAIL / DEMO_PASSWORD from the environment, or the defaults below.
// It adds no builds, runs or spending: a demo that shows a finished build must show one
// that really ran (see the honesty rule in hackathon/plan.md).

import pg from 'pg';
import { hashPassword, normalizeEmail, passwordProblem } from '../src/auth/password.ts';

const url = process.env.DATABASE_URL ?? 'postgres://postgres:makabl@localhost:5433/makabl';
if (!['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname)) {
  throw new Error('refusing to seed demo data into a non-local database');
}

const email = normalizeEmail(process.env.DEMO_EMAIL ?? 'demo@makabl.local');
const password = process.env.DEMO_PASSWORD ?? 'demo-password-local';
if (!email) throw new Error('DEMO_EMAIL is not a valid email');
const problem = passwordProblem(password);
if (problem) throw new Error(`DEMO_PASSWORD: ${problem}`);

// A small, believable idea for the Easy-mode story: a restaurant owner wants table bookings.
// Acceptance criteria are left empty so each feature type's defaults apply. The relay and
// models match the Budget preset, which runs on Gemini's free tier.
const PROJECT = {
  name: 'Table bookings',
  spec: {
    idea: 'Customers book a table at my restaurant. My staff see today’s bookings and can change or cancel them.',
    features: [
      { type: 'auth', name: 'Staff sign-in', acceptance: [] },
      { type: 'migration', name: 'Where bookings are saved', acceptance: [] },
      { type: 'crud_endpoint', name: 'Add, change and cancel bookings', acceptance: [] },
      { type: 'page', name: 'Today’s bookings', acceptance: [] },
    ],
    commercialUse: true,
    horizon: 'first_month',
    monthlyVisitors: 1000,
    buildModel: 'google/gemini-3.6-flash',
    unpricedItems: ['Custom domain'],
    relay: {
      spec: 'google/gemini-3.5-flash-lite',
      architect: 'google/gemini-3.6-flash',
      review: 'google/gemini-3.5-flash-lite',
    },
    retryRate: 1,
    caching: true,
  },
};

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows: users } = await client.query<{ id: string }>(
    `insert into users (email, password_hash) values ($1, $2)
     on conflict (email) do update set password_hash = excluded.password_hash returning id`,
    [email, await hashPassword(password)],
  );
  const owner = users[0]!.id;

  const { rowCount } = await client.query('select 1 from projects where owner_id = $1 and name = $2', [owner, PROJECT.name]);
  if (rowCount) {
    console.log(`project "${PROJECT.name}" already exists for ${email}; left as it is`);
  } else {
    const { rows } = await client.query<{ id: string }>(
      `insert into projects (owner_id, name, state, commercial_use, build_mode)
       values ($1, $2, 'costed', true, 'live') returning id`,
      [owner, PROJECT.name],
    );
    await client.query(
      `insert into project_specs (project_id, version, spec, created_by) values ($1, 1, $2, 'user')`,
      [rows[0]!.id, JSON.stringify(PROJECT.spec)],
    );
    console.log(`created project "${PROJECT.name}" (ready to price)`);
  }
  console.log(`demo account ready: ${email}`);
} finally {
  await client.end();
}
