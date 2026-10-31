import { spawnSync } from 'node:child_process';
import pg from 'pg';

const url = process.env.DATABASE_URL ?? 'postgres://postgres:makabl@localhost:5433/makabl';
if (!['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname)) {
  throw new Error(`refusing to initialize a non-local database at ${new URL(url).hostname}`);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
let initialized: boolean;
try {
  const { rows } = await client.query<{ tables: number; has_users: boolean }>(
    `select count(*)::int as tables,
            exists(select 1 from information_schema.tables where table_schema = 'public' and table_name = 'users') as has_users
       from information_schema.tables where table_schema = 'public'`,
  );
  if (rows[0]!.has_users) {
    initialized = true;
  } else if (rows[0]!.tables === 0) {
    initialized = false;
  } else {
    throw new Error('The local database has tables but no MAKABL users table. Refusing to reset it.');
  }
} finally {
  await client.end();
}

if (initialized) {
  console.log('local database schema already exists; keeping its data');
} else {
  console.log('initializing the empty local database schema');
  const result = spawnSync(process.execPath, ['scripts/db-reset.ts'], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('local database initialization failed');
}

// A database made before a patch existed is brought up to date without being reset.
const patch = spawnSync(process.execPath, ['scripts/db-patch.ts'], { stdio: 'inherit' });
if (patch.status !== 0) throw new Error('applying database patches failed');
