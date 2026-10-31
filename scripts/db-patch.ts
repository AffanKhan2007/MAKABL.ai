// Apply every file in db/patches/ to the local database. Each patch is idempotent, so this is
// safe to run any time, and it keeps a database made before a patch up to date without a reset.
//
//   npm run db:patch              (the app's database)
//   npm run db:patch -- --test    (the tests' database)

import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

const test = process.argv.includes('--test');
const url = test
  ? process.env.TEST_DATABASE_URL ?? 'postgres://postgres:makabl@localhost:5433/makabl_test'
  : process.env.DATABASE_URL ?? 'postgres://postgres:makabl@localhost:5433/makabl';
if (!['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname)) {
  throw new Error('refusing to patch a non-local database');
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const file of (await readdir('db/patches')).filter((f) => f.endsWith('.sql')).sort()) {
    await client.query(await readFile(`db/patches/${file}`, 'utf8'));
    console.log(`applied ${file}`);
  }
} finally {
  await client.end();
}
