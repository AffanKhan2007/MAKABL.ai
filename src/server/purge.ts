import { workspaceDir } from './paths.ts';
import { rm } from 'node:fs/promises';
import { db } from './db.ts';

// Delete a project and everything recorded about it (NFR-11). Runs as the login role,
// after the caller has confirmed the user owns the project, because the event log and
// ledger are append-only to everyone else. Calibration runs are kept: they hold token
// counts and costs only, with no link back to the project.

/** Child tables first; each statement removes only this project's rows. */
const DELETES = [
  'delete from build_tool_results where project_id = $1',
  'delete from test_runs where project_id = $1',
  'delete from deployments where environment_id in (select id from environments where project_id = $1)',
  'delete from environments where project_id = $1',
  'delete from usage_events where reservation_id in (select id from reservations where project_id = $1)',
  'delete from cost_ledger_entries where project_id = $1',
  'delete from reservations where project_id = $1',
  'delete from budgets where project_id = $1',
  'delete from approvals where project_id = $1',
  'delete from activity_events where project_id = $1',
  'delete from agent_runs where task_id in (select id from tasks where project_id = $1)',
  'delete from task_dependencies where task_id in (select id from tasks where project_id = $1)',
  'delete from tasks where project_id = $1',
  'delete from artifact_versions where artifact_id in (select id from artifacts where project_id = $1)',
  'delete from artifacts where project_id = $1',
  'delete from cost_estimate_items where estimate_id in (select id from cost_estimates where project_id = $1)',
  'delete from cost_estimates where project_id = $1',
  'delete from secret_refs where project_id = $1',
  'delete from project_specs where project_id = $1',
  'delete from projects where id = $1',
];

export async function purgeProject(projectId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw new Error('invalid project id');
  const c = await db().connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('makabl.purge_project', $1, true)`, [projectId]);
    for (const sql of DELETES) await c.query(sql, [projectId]);
    await c.query('commit');
  } catch (err) {
    await c.query('rollback');
    throw err;
  } finally {
    c.release();
  }
  await rm(workspaceDir(projectId), { recursive: true, force: true });
}
