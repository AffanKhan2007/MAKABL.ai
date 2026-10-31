import pg from 'pg';

// One pool per server process. Next's dev server reloads modules on edit, so the pool
// lives on globalThis rather than in module scope, or every reload would leak one.
//
// Connects as the configured user (the local superuser in development), so row-level
// security is not in force here. Production must connect as makabl_app and pass the
// signed-in user to PgGateStore.

const g = globalThis as typeof globalThis & { __makablPool?: pg.Pool };

const UNREACHABLE = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNRESET', '57P03', '57P01']);

/**
 * True when an error means the database cannot be reached at all (not running, wrong
 * host, still starting), as opposed to a query failing. Node reports a refused
 * connection to localhost as an AggregateError of one failure per address.
 */
export function isDbUnavailable(err: unknown): boolean {
  if (err instanceof DbUnavailableError) return true;
  if (err instanceof AggregateError) return err.errors.length > 0 && err.errors.every(isDbUnavailable);
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && UNREACHABLE.has(code)) return true;
  return err instanceof Error && /timeout exceeded when trying to connect/i.test(err.message);
}

export const DB_UNAVAILABLE_MESSAGE = process.env.NODE_ENV === 'production'
  ? 'The service is temporarily unavailable. Please try again shortly.'
  : 'The database is not running. Start it with "npm run db:local", then reload.';

/**
 * A plain, named error for "the database cannot be reached". Node reports a refused
 * connection as an AggregateError, which React cannot pass through its request cache,
 * so code that hands errors to React converts to this first.
 */
export class DbUnavailableError extends Error {
  constructor() {
    super(DB_UNAVAILABLE_MESSAGE);
    this.name = 'DbUnavailableError';
  }
}

export function db(): pg.Pool {
  if (!g.__makablPool) {
    const pool = new pg.Pool({
      // 127.0.0.1 rather than localhost: localhost resolves to both IPv6 and IPv4, and a
      // refused connection then surfaces as an AggregateError that React's development
      // tooling cannot handle, turning "database down" into a blank page.
      connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:makabl@127.0.0.1:5433/makabl',
      max: 10,
    });
    // Idle connections report errors here when the database stops or restarts. Without
    // a listener Node treats that as an uncaught exception and the server can exit; the
    // pool discards the broken connection and opens a new one on the next query.
    pool.on('error', (err) => console.warn(`database connection lost: ${err.message}`));
    g.__makablPool = pool;
  }
  return g.__makablPool;
}
