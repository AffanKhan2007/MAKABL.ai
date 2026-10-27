import { join } from 'node:path';
import { Workspace } from '../build/workspace.ts';
import { withTx, type DbScope } from '../db/scope.ts';
import { zip, type ZipEntry } from '../util/zip.ts';
import { db } from './db.ts';
import { planFor } from './plan.ts';
import type { Project } from './projects.ts';

// Export a project as a zip (FR-30, NFR-10): every spec version, the current cost plan,
// the ledger, approvals, the event log and the code, as plain files the user can take
// elsewhere. Everything is read under the user's row-level security.

const MAX_CODE_BYTES = 50 * 1024 * 1024;

const json = (path: string, value: unknown): ZipEntry => ({ path, data: Buffer.from(`${JSON.stringify(value, null, 2)}\n`) });

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Quote everything; neutralise a leading formula character for spreadsheet safety.
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

export async function exportProject(project: Project, scope: DbScope): Promise<Buffer> {
  const data = await withTx(db(), scope, async (c) => ({
    specs: (await c.query('select version, spec, created_by, created_at from project_specs where project_id = $1 order by version', [project.id])).rows,
    ledger: (await c.query('select created_at, task_id, description, amount, currency, basis from cost_ledger_entries where project_id = $1 order by created_at', [project.id])).rows,
    approvals: (await c.query('select kind, status, request, decided_at, created_at from approvals where project_id = $1 order by created_at', [project.id])).rows,
    events: (await c.query('select seq, task_id, type, payload, created_at from activity_events where project_id = $1 order by seq', [project.id])).rows,
    checks: (await c.query('select gate, check_name, passed, authored_by, log_ref, created_at from test_runs where project_id = $1 order by created_at', [project.id])).rows,
  }));

  const entries: ZipEntry[] = [
    json('project.json', { id: project.id, name: project.name, state: project.state, buildMode: project.buildMode, exportedAt: new Date().toISOString() }),
    ...data.specs.map((s) => json(`spec/v${s.version}.json`, s)),
    json('cost-plan.json', await planFor(project.spec)),
    json('approvals.json', data.approvals),
    json('events.json', data.events),
    json('checks.json', data.checks),
    {
      path: 'ledger.csv',
      data: Buffer.from([
        'created_at,task_id,description,amount,currency,basis',
        ...data.ledger.map((r) => [r.created_at.toISOString(), r.task_id, r.description, r.amount, r.currency, r.basis].map(csvCell).join(',')),
      ].join('\n') + '\n'),
    },
  ];

  const ws = new Workspace(join(process.cwd(), '.workspaces', project.id));
  let bytes = 0;
  for (const file of await ws.list('.').catch(() => [] as string[])) {
    const text = await ws.read(file).catch(() => null);
    if (text === null) continue;
    const buf = Buffer.from(text, 'utf8');
    bytes += buf.length;
    if (bytes > MAX_CODE_BYTES) {
      entries.push({ path: 'code/EXPORT-TRUNCATED.txt', data: Buffer.from('The code was larger than 50 MB; the rest was left out.\n') });
      break;
    }
    entries.push({ path: `code/${file}`, data: buf });
  }
  return zip(entries);
}
