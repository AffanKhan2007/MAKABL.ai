import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { DATABASE_URL, createProject } from './support/envs.ts';

// purgeProject uses the app's pool, so point it at the test database first.
process.env.DATABASE_URL = DATABASE_URL;
const { purgeProject } = await import('../src/server/purge.ts');
const { db } = await import('../src/server/db.ts');

const admin = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000 });
const ready = await admin.query('select 1 from build_tool_results limit 1').then(() => true, () => false);

describe('deleting a project', { skip: ready ? false : 'no test database (npm run db:reset:test)' }, () => {
  after(async () => { await admin.end(); await db().end(); });

  async function seed(projectId: string) {
    await admin.query(`insert into project_specs (project_id, version, spec, created_by) values ($1, 1, '{}', 'user')`, [projectId]);
    await admin.query(`insert into activity_events (project_id, type, payload) values ($1, 'task_started', '{}')`, [projectId]);
    const { rows } = await admin.query<{ id: string }>(
      `insert into reservations (project_id, task_id, idempotency_key, worst_case, currency, month, status)
       values ($1, 't', $2, 1, 'USD', '2026-10', 'settled') returning id`, [projectId, `k-${projectId}`]);
    await admin.query(
      `insert into cost_ledger_entries (ledger, project_id, task_id, reservation_id, amount, currency, basis, description)
       values ('customer', $1, 't', $2, 1, 'USD', 'usage_observed', 'x')`, [projectId, rows[0]!.id]);
    await admin.query(`insert into budgets (project_id, project_cap, monthly_cap) values ($1, 5, 5)`, [projectId]);
    await admin.query(`insert into build_tool_results (project_id, step_key, content, is_error) values ($1, 's', 'c', false)`, [projectId]);
    await admin.query(`insert into test_runs (project_id, gate, check_name, passed, authored_by) values ($1, 'G4', 'x', true, 'platform')`, [projectId]);
  }

  const count = async (table: string, projectId: string) =>
    Number((await admin.query(`select count(*) from ${table} where ${table === 'projects' ? 'id' : 'project_id'} = $1`, [projectId])).rows[0].count);

  test('the event log and ledger stay append-only outside a purge', async () => {
    const p = await createProject(admin);
    await seed(p);
    await assert.rejects(admin.query('delete from activity_events where project_id = $1', [p]), /append-only/);
    await assert.rejects(admin.query('delete from cost_ledger_entries where project_id = $1', [p]), /append-only/);
    // A purge flag for a different project does not unlock this one.
    const c = await admin.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('makabl.purge_project', '00000000-0000-0000-0000-000000000000', true)`);
      await assert.rejects(c.query('delete from activity_events where project_id = $1', [p]), /append-only/);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  test('a purge removes every row of that project and nothing else', async () => {
    const victim = await createProject(admin);
    const bystander = await createProject(admin);
    await seed(victim);
    await seed(bystander);
    const calibrationBefore = Number((await admin.query('select count(*) from calibration_runs')).rows[0].count);

    await purgeProject(victim);

    for (const t of ['projects', 'project_specs', 'activity_events', 'cost_ledger_entries', 'reservations', 'budgets', 'build_tool_results', 'test_runs']) {
      assert.equal(await count(t, victim), 0, `${t} for the deleted project`);
      assert.equal(await count(t, bystander), t === 'projects' ? 1 : 1, `${t} for the other project`);
    }
    assert.equal(Number((await admin.query('select count(*) from calibration_runs')).rows[0].count), calibrationBefore);
  });
});
