// Drop and recreate the public schema, then apply db/schema.sql and db/roles.sql.
// Destroys all data in the target database; for local databases only.
//
//   node scripts/db-reset.ts          the app's database (DATABASE_URL)
//   node scripts/db-reset.ts --test   the tests' database (TEST_DATABASE_URL), created if missing

import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Always UTF-8: on Windows the cluster defaults to WIN1252, which cannot store characters
// models and test runners print (arrows, check marks, emoji), and an insert would fail.
const UTF8 = "encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0";
const test = process.argv.includes('--test');
const url = test
  ? process.env.TEST_DATABASE_URL ?? 'postgres://postgres:makabl@localhost:5433/makabl_test'
  : process.env.DATABASE_URL ?? 'postgres://postgres:makabl@localhost:5433/makabl';
const target = new URL(url);
if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname)) {
  throw new Error(`refusing to reset non-local database at ${target.hostname}`);
}
const dbName = decodeURIComponent(target.pathname.slice(1));
if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error(`unexpected database name: ${dbName}`);

// Create the database if it does not exist yet, via the server's maintenance database.
const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
try {
  const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [dbName]);
  if (rowCount === 0) {
    await admin.query(`create database ${dbName} ${UTF8}`);
    console.log(`created database ${dbName}`);
  }
} finally {
  await admin.end();
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('drop schema if exists public cascade; create schema public;');
  for (const file of ['db/schema.sql', 'db/roles.sql']) {
    await client.query(await readFile(file, 'utf8'));
    console.log(`applied ${file} to ${dbName}`);
  }
  const { rows } = await client.query(
    `select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
  );
  console.log(`${rows[0].n} tables in public`);
} finally {
  await client.end();
}
