import { scanWorkspace } from '../build/secret-scan.ts';
import type { Workspace } from '../build/workspace.ts';
import { withTx, type DbScope } from '../db/scope.ts';
import { taskIdFor } from '../spec/acceptance.ts';
import { db } from './db.ts';
import type { Project } from './projects.ts';

// Verification report (working model section 10). "Verified" means only that the listed
// checks passed, so the report lists what ran, who wrote the tests, and what was not
// checked at all, rather than showing a single badge.

export interface ProjectCheck {
  name: string;
  gate: string;
  passed: boolean;
  summary: string;
}

/** G4 checks once every feature has passed its own checks. */
export async function runProjectChecks(project: Project, ws: Workspace): Promise<ProjectCheck[]> {
  const checks: ProjectCheck[] = [];
  const secrets = await scanWorkspace(ws);
  checks.push({
    name: 'No secrets in the code', gate: 'G4', passed: secrets.length === 0,
    summary: secrets.length === 0
      ? 'No API keys, tokens, private keys or .env files found.'
      : secrets.slice(0, 10).map((f) => `${f.file}${f.line ? `:${f.line}` : ''} — ${f.kind}`).join('\n'),
  });

  if (project.buildMode === 'live') {
    const audit = await ws.run(['npm', 'audit', '--omit=dev', '--json'], 120_000, 200_000);
    let high = -1;
    try {
      const v = (JSON.parse(audit.output) as { metadata?: { vulnerabilities?: Record<string, number> } }).metadata?.vulnerabilities;
      if (v) high = (v.high ?? 0) + (v.critical ?? 0);
    } catch { /* reported as unreadable below */ }
    checks.push({
      name: 'No high or critical dependency advisories', gate: 'G4', passed: high === 0,
      summary: high < 0 ? 'npm audit output could not be read.' : `${high} high or critical advisories.`,
    });
  }
  return checks;
}

export async function recordProjectChecks(projectId: string, checks: ProjectCheck[], scope: DbScope): Promise<void> {
  await withTx(db(), scope, async (c) => {
    for (const ch of checks) {
      await c.query(
        `insert into test_runs (project_id, gate, check_name, passed, authored_by, log_ref)
         values ($1, $2, $3, $4, 'platform', $5)`,
        [projectId, ch.gate, ch.name, ch.passed, ch.summary],
      );
    }
  });
}

export type FeatureStatus = 'not started' | 'building' | 'verified' | 'failed' | 'refused';

export interface FeatureReport {
  name: string;
  taskId: string;
  status: FeatureStatus;
  acceptance: string[];
  checks: Array<{ name: string; gate: string; passed: boolean; testsAuthoredBy: string }>;
}

export interface VerificationReport {
  features: FeatureReport[];
  projectChecks: ProjectCheck[];
  notChecked: string[];
}

const STATUS_BY_EVENT: Record<string, FeatureStatus> = {
  task_started: 'building', task_verified: 'verified', task_failed: 'failed', task_refused: 'refused',
};

export async function loadReport(project: Project, scope: DbScope): Promise<VerificationReport> {
  return withTx(db(), scope, async (c) => {
    const { rows: events } = await c.query<{ task_id: string; type: string; payload: { results?: FeatureReport['checks'] } }>(
      `select task_id, type, payload from activity_events
        where project_id = $1 and task_id is not null
          and type in ('task_started', 'task_verified', 'task_failed', 'task_refused', 'checks_run')
        order by seq`,
      [project.id]);
    const status = new Map<string, FeatureStatus>();
    const checks = new Map<string, FeatureReport['checks']>();
    for (const e of events) {
      if (e.type === 'checks_run') checks.set(e.task_id, e.payload.results ?? []);
      else status.set(e.task_id, STATUS_BY_EVENT[e.type]!);
    }

    const { rows: runs } = await c.query<{ check_name: string; gate: string; passed: boolean; log_ref: string | null }>(
      `select distinct on (check_name) check_name, gate, passed, log_ref from test_runs
        where project_id = $1 and gate = 'G4' order by check_name, created_at desc`,
      [project.id]);

    const features = project.spec.features.map((f): FeatureReport => {
      const taskId = taskIdFor(f);
      return {
        name: f.name, taskId, status: status.get(taskId) ?? 'not started',
        acceptance: f.acceptance, checks: checks.get(taskId) ?? [],
      };
    });
    const agentTests = features.some((f) => f.checks.some((c) => c.testsAuthoredBy === 'agent'));
    return {
      features,
      projectChecks: runs.map((r) => ({ name: r.check_name, gate: r.gate, passed: r.passed, summary: r.log_ref ?? '' })),
      notChecked: [
        ...(agentTests ? ['Tests were written by the same model that wrote the code; passing shows the code matches those tests, not that it is correct.'] : []),
        ...(project.buildMode === 'simulated' ? ['Simulated build: features are placeholders, so nothing about a real app was checked.'] : []),
        'Acceptance criteria that tests do not cover were not checked automatically.',
        'No security review of the generated code, and no check of the generated app\'s own database access rules.',
        'No end-to-end browser tests, accessibility check or load test.',
        'Not deployed: preview and production deploys are not built yet.',
      ],
    };
  });
}
