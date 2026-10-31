import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { usd } from '../src/domain/types.ts';
import { PgEventLog } from '../src/db/pg-event-log.ts';
import { PgGateStore } from '../src/db/pg-gate-store.ts';
import { PgToolLog } from '../src/db/pg-tool-log.ts';
import { APP_ROLE, withTx } from '../src/db/scope.ts';
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

  // The app connects as the login role and switches per transaction (db/scope.ts).
  test('a scoped transaction acts as makabl_app and reverts before the connection is reused', async () => {
    const one = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
    try {
      const inside = await withTx(one, { role: APP_ROLE, userId: userA }, async (c) =>
        (await c.query<{ u: string; me: string }>(`select current_user as u, current_setting('app.user_id', true) as me`)).rows[0]);
      assert.deepEqual(inside, { u: APP_ROLE, me: userA });
      const after = (await one.query<{ u: string; me: string | null }>(
        `select current_user as u, nullif(current_setting('app.user_id', true), '') as me`)).rows[0];
      assert.notEqual(after?.u, APP_ROLE);
      assert.equal(after?.me, null);
    } finally {
      await one.end();
    }
  });

  test('the Gate, event log and tool log isolate users when scoped from the login pool', async () => {
    const asA = { role: APP_ROLE, userId: userA };
    const asB = { role: APP_ROLE, userId: userB };
    const gateA = new BudgetGate(new PgGateStore(admin, asA), NOW);
    await gateA.setBudget(projectA, { projectCap: usd(5), monthlyCap: usd(5) });
    await assert.rejects(new BudgetGate(new PgGateStore(admin, asB), NOW).getBudget(projectA), /no budget set/);

    assert.ok((await new PgEventLog(admin, asA).list(projectA)).length > 0);
    assert.equal((await new PgEventLog(admin, asB).list(projectA)).length, 0);

    await new PgToolLog(admin, projectA, asA).put('t:a1:t1:toolu_1', { content: 'secret file list', isError: false });
    assert.equal((await new PgToolLog(admin, projectA, asA).get('t:a1:t1:toolu_1'))?.content, 'secret file list');
    assert.equal(await new PgToolLog(admin, projectA, asB).get('t:a1:t1:toolu_1'), undefined);
    await assert.rejects(new PgToolLog(admin, projectA, asB).put('t:a1:t1:toolu_2', { content: 'x', isError: false }), /row-level security/);
  });

  test('model and test-runner text outside Windows-1252 is stored intact', async () => {
    // Test runners print ✖ and models write arrows and emoji; a WIN1252 database rejects them.
    const asA = { role: APP_ROLE, userId: userA };
    const text = '✖ 1 failing → fix ✓ 🚀';
    await new PgToolLog(admin, projectA, asA).put('t:a1:t1:toolu_utf8', { content: text, isError: true });
    assert.equal((await new PgToolLog(admin, projectA, asA).get('t:a1:t1:toolu_utf8'))?.content, text);
    const e = await new PgEventLog(admin, asA).append({ projectId: projectA, taskId: null, type: 'relay_review', payload: { review: text } });
    assert.equal(e.payload.review, text);
  });

  test('child tables without a project_id are isolated through their parent', async () => {
    const { rows } = await admin.query<{ id: string }>(
      `insert into artifacts (project_id, kind, path) values ($1, 'code', 'a.ts'), ($2, 'code', 'b.ts') returning id`,
      [projectA, projectB]);
    await admin.query(
      `insert into artifact_versions (artifact_id, version, content_ref, spec_version) values ($1, 1, 'ref-a', 1), ($2, 1, 'ref-b', 1)`,
      [rows[0]!.id, rows[1]!.id]);
    const seen = await withTx(admin, { role: APP_ROLE, userId: userA }, async (c) =>
      (await c.query<{ content_ref: string }>('select content_ref from artifact_versions')).rows.map((r) => r.content_ref));
    assert.ok(seen.includes('ref-a'));
    assert.ok(!seen.includes('ref-b'));
  });

  test('a decided approval records who decided it', async () => {
    const gateA = new BudgetGate(new PgGateStore(admin, { role: APP_ROLE, userId: userA }), NOW);
    await gateA.setBudget(projectA, { projectCap: usd(0.1), monthlyCap: usd(0.1) });
    const blocked = await gateA.authorize({
      projectId: projectA, taskId: 't_dec', taskCeiling: usd(1), idempotencyKey: 'rls:decide', worstCase: usd(5), description: 'x',
    });
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    await gateA.decide(projectA, blocked.approval.id, 'declined', 0, userA);
    const { rows } = await admin.query<{ decided_by: string }>('select decided_by from approvals where id = $1', [blocked.approval.id]);
    assert.equal(rows[0]?.decided_by, userA);
  });
});
