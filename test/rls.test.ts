import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { usd } from '../src/domain/types.ts';
import { PgGateStore } from '../src/db/pg-gate-store.ts';
import { BudgetGate } from '../src/gate/budget-gate.ts';
import { createProject, DATABASE_URL, NOW } from './support/envs.ts';

// Tenant isolation (NFR-01). RLS does not apply to superusers, so every check here runs
// as the makabl_app role from db/roles.sql.

const admin = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000 });
const ready = await admin.query(`select 1 from pg_roles where rolname = 'makabl_app'`).then((r) => r.rowCount === 1, () => false);

describe('row-level security', { skip: ready ? false : 'no database with db/roles.sql applied' }, async () => {
  if (!ready) {
    await admin.end();
    return;
  }

  /** Pool whose connections act as makabl_app instead of the superuser. */
  const app = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  app.on('connect', (c) => { void c.query('set role makabl_app'); });
  after(async () => { await app.end(); await admin.end(); });

  const userOf = async (projectId: string) =>
    (await admin.query<{ owner_id: string }>('select owner_id from projects where id = $1', [projectId])).rows[0]!.owner_id;

  /** Run fn in a transaction as makabl_app with app.user_id set (or unset). */
  async function as<T>(userId: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query('begin');
      if (userId) await c.query(`select set_config('app.user_id', $1, true)`, [userId]);
      return await fn(c);
    } finally {
      await c.query('rollback');
      c.release();
    }
  }

  const projectA = await createProject(admin);
  const projectB = await createProject(admin);
  const userA = await userOf(projectA);
  const userB = await userOf(projectB);
  await admin.query(
    `insert into activity_events (project_id, type, payload) values ($1, 'task_paused', '{}'), ($2, 'task_paused', '{}')`,
    [projectA, projectB]);

  test('the app role is not a superuser and does not bypass RLS', async () => {
    const { rows } = await as(null, (c) => c.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'select rolsuper, rolbypassrls from pg_roles where rolname = current_user'));
    assert.deepEqual(rows[0], { rolsuper: false, rolbypassrls: false });
  });

  test('a user sees only their own projects, events and user row', async () => {
    await as(userA, async (c) => {
      const projects = (await c.query<{ id: string }>('select id from projects')).rows.map((r) => r.id);
      assert.ok(projects.includes(projectA));
      assert.ok(!projects.includes(projectB));
      const events = await c.query('select 1 from activity_events where project_id = $1', [projectB]);
      assert.equal(events.rowCount, 0);
      const users = (await c.query<{ id: string }>('select id from users')).rows.map((r) => r.id);
      assert.deepEqual(users, [userA]);
    });
  });

  test('with app.user_id unset, nothing is visible', async () => {
    await as(null, async (c) => {
      assert.equal((await c.query('select 1 from projects')).rowCount, 0);
      assert.equal((await c.query('select 1 from activity_events')).rowCount, 0);
    });
  });

  test("a user cannot write into another user's project", async () => {
    await as(userA, async (c) => {
      await assert.rejects(
        c.query(`insert into activity_events (project_id, type, payload) values ($1, 'task_paused', '{}')`, [projectB]),
        /row-level security/,
      );
    });
  });

  test('ledger and event rows cannot be changed or deleted by the app role', async () => {
    await as(userA, async (c) => {
      await assert.rejects(c.query('delete from activity_events where project_id = $1', [projectA]), /permission denied/);
    });
    await as(userA, async (c) => {
      await assert.rejects(c.query(`update cost_ledger_entries set amount = 0`), /permission denied/);
    });
  });

  test('the Budget Gate works under RLS for the owner and cannot see other tenants', async () => {
    const gateA = new BudgetGate(new PgGateStore(app, { userId: userA }), NOW);
    await gateA.setBudget(projectA, { projectCap: usd(1), monthlyCap: usd(1) });
    await gateA.execute(
      { projectId: projectA, taskId: 't_rls', taskCeiling: usd(1), idempotencyKey: 'rls:1', worstCase: usd(0.2), description: 'rls' },
      async () => ({ result: 'ok', observed: usd(0.1) }),
    );
    assert.equal(await gateA.spent(projectA), usd(0.1));

    // User B's gate cannot read A's budget, spend or approvals.
    const gateB = new BudgetGate(new PgGateStore(app, { userId: userB }), NOW);
    await assert.rejects(gateB.getBudget(projectA), /no budget set/);
    assert.equal(await gateB.spent(projectA), 0);
    // ...and cannot plant a budget on A's project.
    await assert.rejects(gateB.setBudget(projectA, { projectCap: usd(999), monthlyCap: usd(999) }), /row-level security/);
  });
});
