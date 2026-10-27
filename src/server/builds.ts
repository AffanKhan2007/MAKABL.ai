import { join } from 'node:path';
import { ClaudeAdapter } from '../adapters/claude.ts';
import { FeatureBuilder } from '../build/build-loop.ts';
import { MemoryToolLog } from '../build/tool-log.ts';
import { Verifier } from '../build/verifier.ts';
import { Workspace } from '../build/workspace.ts';
import { MemoryRunLog } from '../calibration/runs.ts';
import { PgEventLog } from '../db/pg-event-log.ts';
import { PgGateStore } from '../db/pg-gate-store.ts';
import { usd } from '../domain/types.ts';
import { BudgetGate } from '../gate/budget-gate.ts';
import { db } from './db.ts';
import { planFor, registry } from './plan.ts';
import { getProject, setProjectState } from './projects.ts';
import { featureSlug, simulatedTransport } from './simulated-model.ts';

// Runs a project's build in the background of the server process: one feature after
// another through the build loop. A budget block pauses it; approving the request
// starts it again, and finished features are skipped.
//
// Simulated builds only for now: no live-mode path exists yet, so nothing here can
// call the Claude API. Tool logs and the running set live in this process, so a paused
// build resumes only while the dev server keeps running.

interface BuildState {
  running: Set<string>;
  toolLogs: Map<string, MemoryToolLog>;
}
const g = globalThis as typeof globalThis & { __makablBuilds?: BuildState };
const state = (g.__makablBuilds ??= { running: new Set(), toolLogs: new Map() });

export function gate(): BudgetGate {
  return new BudgetGate(new PgGateStore(db()));
}

export const isRunning = (projectId: string): boolean => state.running.has(projectId);

/** Starts the build unless it is already running. Returns whether it started. */
export function startBuild(projectId: string): boolean {
  if (state.running.has(projectId)) return false;
  state.running.add(projectId);
  void runBuild(projectId)
    .catch(async (err) => {
      console.error('build failed', projectId, err);
      await new PgEventLog(db()).append({
        projectId, taskId: null, type: 'task_failed',
        payload: { reason: `Build stopped by an internal error: ${err instanceof Error ? err.message : String(err)}` },
      });
      await setProjectState(projectId, 'paused');
    })
    .finally(() => state.running.delete(projectId));
  return true;
}

async function verifiedTasks(projectId: string): Promise<Set<string>> {
  const { rows } = await db().query<{ task_id: string }>(
    `select distinct task_id from activity_events where project_id = $1 and type = 'task_verified'`,
    [projectId],
  );
  return new Set(rows.map((r) => r.task_id));
}

async function runBuild(projectId: string): Promise<void> {
  const project = await getProject(projectId);
  if (!project) throw new Error('project not found');
  if (project.buildMode !== 'simulated') throw new Error('live builds are not enabled yet');

  const g = gate();
  const budget = await g.getBudget(projectId);
  const events = new PgEventLog(db());
  const adapter = new ClaudeAdapter(g, registry, simulatedTransport());
  const toolLog = state.toolLogs.get(projectId) ?? new MemoryToolLog();
  state.toolLogs.set(projectId, toolLog);
  const workspace = new Workspace(join(process.cwd(), '.workspaces', projectId));
  await workspace.init();
  const done = await verifiedTasks(projectId);
  const plan = await planFor(project.spec);
  const paid = plan.paths.find((p) => p.path === 'paid')!;

  await setProjectState(projectId, 'building');
  for (const [i, feature] of project.spec.features.entries()) {
    const taskId = `feature-${i + 1}`;
    if (done.has(taskId)) continue;
    const slug = featureSlug(feature.name);
    const quoted = paid.lines.find((l) => l.label === `Build: ${feature.name}`)?.range;
    const builder = new FeatureBuilder({
      adapter, workspace, events, tools: toolLog,
      // Simulated runs stay in memory so fake data never reaches calibration_runs.
      runs: new MemoryRunLog(),
      verifier: new Verifier([{
        name: `features/${slug}.ts exports the feature`, gate: 'G2', timeoutMs: 20_000, testsAuthoredBy: 'platform',
        command: [process.execPath, '-e',
          `const s=require('fs').readFileSync(${JSON.stringify(`features/${slug}.ts`)},'utf8');if(!s.includes('export const feature'))process.exit(1)`],
      }]),
    });
    const out = await builder.build({
      projectId, taskId, featureType: feature.type, featureName: feature.name,
      spec: `${project.spec.idea}\n\nBuild the "${feature.name}" feature.`,
      acceptance: [`features/${slug}.ts exports the feature`],
      model: project.spec.buildModel,
      taskCeiling: budget.projectCap,
      retryLimit: 2,
      retryCostLimit: usd(5),
      maxTurns: 8,
      maxTokens: 8_000,
      ...(quoted ? { quoted: { low: quoted.low, high: quoted.high } } : {}),
    });
    if (out.status !== 'verified') {
      await setProjectState(projectId, 'paused');
      return;
    }
  }
  // Every feature passed its checks. Integration checks and preview deploy come next.
  await setProjectState(projectId, 'verifying');
}
