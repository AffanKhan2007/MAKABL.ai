import { workspaceDir } from './paths.ts';
import Anthropic from '@anthropic-ai/sdk';
import { ClaudeAdapter, sdkTransport, type ClaudeTransport } from '../adapters/claude.ts';
import { BUILDER_SYSTEM_PROMPT, FeatureBuilder } from '../build/build-loop.ts';
import { INSTALL_COMMAND, LIVE_CHECKS, TEMPLATE_GUIDE, writeTemplate } from '../build/template.ts';
import { Verifier, type CheckSpec } from '../build/verifier.ts';
import { Workspace } from '../build/workspace.ts';
import { MemoryRunLog, type RunLog } from '../calibration/runs.ts';
import { PgEventLog } from '../db/pg-event-log.ts';
import { PgGateStore } from '../db/pg-gate-store.ts';
import { PgRunLog } from '../db/pg-run-log.ts';
import { PgToolLog } from '../db/pg-tool-log.ts';
import type { DbScope } from '../db/scope.ts';
import { BudgetGate } from '../gate/budget-gate.ts';
import { db } from './db.ts';
import { liveModeStatus } from './live-mode.ts';
import { planFor, registry } from './plan.ts';
import { getProject, setProjectState, verifiedTasks, type Project } from './projects.ts';
import { userScope } from './session.ts';
import { recordProjectChecks, runProjectChecks } from './verification.ts';
import { featureSlug, taskIdFor } from '../spec/acceptance.ts';
import { simulatedTransport } from './simulated-model.ts';

// Runs a project's build in the background of the server process: one feature after
// another through the build loop. A budget block pauses it; approving the request
// starts it again. Finished features are skipped, and earlier turns of an interrupted
// feature replay from the Gate and the tool log, which live in Postgres, so a build can
// also be resumed after the server restarts.
//
// Simulated builds use a scripted model and never touch calibration data. Live builds
// call the Claude API through the adapter (and so the Budget Gate), work on the Next.js
// template, run the real checks, and log calibration runs.

interface BuildState { running: Set<string> }
const g = globalThis as typeof globalThis & { __makablBuilds?: BuildState };
const state = (g.__makablBuilds ??= { running: new Set() });

export function gateFor(scope: DbScope): BudgetGate {
  return new BudgetGate(new PgGateStore(db(), scope));
}

/** The current user's Gate. */
export async function gate(): Promise<BudgetGate> {
  return gateFor(await userScope());
}

export const isRunning = (projectId: string): boolean => state.running.has(projectId);

/**
 * Start the build unless it is already running. Runs as `userId`, captured now, because
 * the build outlives the request that started it. Returns whether it started.
 */
export function startBuild(projectId: string, userId: string): boolean {
  if (state.running.has(projectId)) return false;
  state.running.add(projectId);
  void runBuild(projectId, userId)
    .catch(async (err) => {
      console.error('build stopped', projectId, err);
      const scope = await userScope(userId);
      await new PgEventLog(db(), scope).append({
        projectId, taskId: null, type: 'task_failed',
        payload: { reason: `Build stopped by an internal error: ${err instanceof Error ? err.message : String(err)}` },
      });
      await setProjectState(projectId, 'paused', userId);
    })
    .finally(() => state.running.delete(projectId));
  return true;
}

interface ModeSetup {
  transport: ClaudeTransport;
  runs: RunLog;
  checksFor(slug: string): readonly CheckSpec[];
  systemPrompt: string;
  maxTokens: number;
  maxTurns: number;
  /** What the build is judged against, from the feature's approved criteria. */
  acceptance(slug: string, criteria: string[]): string[];
}

function simulatedSetup(): ModeSetup {
  return {
    transport: simulatedTransport(),
    // Simulated runs stay in memory so fake data never reaches calibration_runs.
    runs: new MemoryRunLog(),
    checksFor: (slug) => [{
      name: `features/${slug}.ts exports the feature`, gate: 'G2', timeoutMs: 20_000, testsAuthoredBy: 'platform',
      command: [process.execPath, '-e',
        `const s=require('fs').readFileSync(${JSON.stringify(`features/${slug}.ts`)},'utf8');if(!s.includes('export const feature'))process.exit(1)`],
    }],
    systemPrompt: BUILDER_SYSTEM_PROMPT,
    maxTokens: 8_000,
    maxTurns: 8,
    acceptance: (slug, criteria) => [`features/${slug}.ts exports the feature`, ...criteria],
  };
}

function liveSetup(): ModeSetup {
  return {
    // Reads ANTHROPIC_API_KEY from the server environment; never passed to the workspace.
    transport: sdkTransport(new Anthropic()),
    runs: new PgRunLog(db()),
    checksFor: () => LIVE_CHECKS,
    systemPrompt: `${BUILDER_SYSTEM_PROMPT}\n\n${TEMPLATE_GUIDE}`,
    maxTokens: 16_000,
    maxTurns: 30,
    acceptance: (_slug, criteria) => [
      ...criteria,
      'Each criterion above that can be checked in code has a passing test in tests/.',
      'The type check and the production build pass.',
    ],
  };
}

/** Make the workspace ready: template and dependencies for live builds. */
async function prepareWorkspace(project: Project, ws: Workspace, events: PgEventLog): Promise<boolean> {
  await ws.init();
  if (project.buildMode !== 'live') return true;
  const fresh = await writeTemplate(ws);
  const install = await ws.run(INSTALL_COMMAND, 600_000);
  await events.append({
    projectId: project.id, taskId: null, type: 'workspace_ready',
    payload: { templateWritten: fresh, installExit: install.exitCode, seconds: Math.round(install.durationMs / 1000) },
  });
  if (install.exitCode !== 0) {
    await events.append({
      projectId: project.id, taskId: null, type: 'task_failed',
      payload: { reason: `Installing the project's dependencies failed (exit ${install.exitCode}).` },
    });
    return false;
  }
  return true;
}

async function runBuild(projectId: string, userId: string): Promise<void> {
  const scope = await userScope(userId);
  const project = await getProject(projectId, userId);
  if (!project) throw new Error('project not found');
  if (project.buildMode === 'live') {
    const live = liveModeStatus();
    if (!live.available) throw new Error(`live builds are not enabled on this server: ${live.missing.join('; ')}`);
  }

  const gate = gateFor(scope);
  const budget = await gate.getBudget(projectId);
  const events = new PgEventLog(db(), scope);
  const mode = project.buildMode === 'live' ? liveSetup() : simulatedSetup();
  const adapter = new ClaudeAdapter(gate, registry, mode.transport);
  const workspace = new Workspace(workspaceDir(projectId));

  // Not running in this process (startBuild checked), so any reservation still held is
  // from a build that was cut off; settle those before carrying on.
  await gate.recoverInterrupted(projectId);
  await setProjectState(projectId, 'building', userId);
  if (!(await prepareWorkspace(project, workspace, events))) {
    await setProjectState(projectId, 'paused', userId);
    return;
  }

  const done = await verifiedTasks(projectId, userId);
  const plan = await planFor(project.spec);
  const paid = plan.paths.find((p) => p.path === 'paid')!;
  const tools = new PgToolLog(db(), projectId, scope);

  for (const feature of project.spec.features) {
    // Stable per name, type and criteria: unchanged features stay done across spec edits.
    const taskId = taskIdFor(feature);
    if (done.has(taskId)) continue;
    const slug = featureSlug(feature.name);
    const quoted = paid.lines.find((l) => l.label === `Build: ${feature.name}`)?.range;
    const builder = new FeatureBuilder({
      adapter, workspace, events, tools, runs: mode.runs,
      verifier: new Verifier(mode.checksFor(slug)),
      systemPrompt: mode.systemPrompt,
    });
    const out = await builder.build({
      projectId, taskId, featureType: feature.type, featureName: feature.name,
      spec: `${project.spec.idea}\n\nBuild the "${feature.name}" feature.`,
      acceptance: mode.acceptance(slug, feature.acceptance),
      model: project.spec.buildModel,
      taskCeiling: budget.projectCap,
      retryLimit: 2,
      retryCostLimit: budget.projectCap,
      maxTurns: mode.maxTurns,
      maxTokens: mode.maxTokens,
      ...(project.buildMode === 'live' ? { effort: 'high' as const } : {}),
      ...(quoted ? { quoted: { low: quoted.low, high: quoted.high } } : {}),
    });
    if (out.status !== 'verified') {
      await setProjectState(projectId, 'paused', userId);
      return;
    }
  }
  // Every feature passed its own checks; now the whole-project checks (G4).
  const checks = await runProjectChecks(project, workspace);
  await recordProjectChecks(projectId, checks, scope);
  const passed = checks.every((c) => c.passed);
  await events.append({
    projectId, taskId: null, type: 'project_checks_run',
    payload: { passed, results: checks.map((c) => ({ name: c.name, passed: c.passed })) },
  });
  // Preview and production deploys are not built yet; 'verifying' is as far as it goes.
  await setProjectState(projectId, passed ? 'verifying' : 'paused', userId);
}
