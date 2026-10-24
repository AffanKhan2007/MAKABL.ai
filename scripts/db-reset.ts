// Drop and recreate the public schema, then apply db/schema.sql and db/roles.sql.
// Destroys all data in DATABASE_URL; intended for the local Docker database only.

import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL ?? 'postgres://postgres:makabl@localhost:5433/makabl';
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`refusing to reset non-local database at ${host}`);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('drop schema if exists public cascade; create schema public;');
  for (const file of ['db/schema.sql', 'db/roles.sql']) {
    await client.query(await readFile(file, 'utf8'));
    console.log(`applied ${file}`);
  }
  const { rows } = await client.query(
    `select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
  );
  console.log(`${rows[0].n} tables in public`);
} finally {
  await client.end();
}
