import pg from 'pg';

// One pool per server process. Next's dev server reloads modules on edit, so the pool
// lives on globalThis rather than in module scope, or every reload would leak one.
//
// Connects as the configured user (the local superuser in development), so row-level
// security is not in force here. Production must connect as makabl_app and pass the
// signed-in user to PgGateStore.

const g = globalThis as typeof globalThis & { __makablPool?: pg.Pool };

export function db(): pg.Pool {
  g.__makablPool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:makabl@localhost:5433/makabl',
    max: 10,
  });
  return g.__makablPool;
}
