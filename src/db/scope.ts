import type pg from 'pg';

// Who a database transaction runs as. Row-level security only applies to roles that are
// neither superuser nor table owner, so app code switches to makabl_app for the length
// of each transaction (SET LOCAL ROLE) and names the user (app.user_id) the policies
// check. Both revert when the transaction ends, before the connection goes back to the
// pool.

export interface DbScope {
  /** Sets app.user_id, the user the row-level security policies check. */
  userId?: string;
  /** Role to act as, e.g. 'makabl_app'. The login role must be a member of it. */
  role?: string;
}

export const APP_ROLE = 'makabl_app';

export async function withTx<T>(pool: pg.Pool, scope: DbScope, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    if (scope.role) {
      if (!/^[a-z_][a-z0-9_]*$/.test(scope.role)) throw new Error(`invalid role name: ${scope.role}`);
      await c.query(`set local role ${scope.role}`);
    }
    if (scope.userId) await c.query(`select set_config('app.user_id', $1, true)`, [scope.userId]);
    const result = await fn(c);
    await c.query('commit');
    return result;
  } catch (err) {
    await c.query('rollback');
    throw err;
  } finally {
    c.release();
  }
}
