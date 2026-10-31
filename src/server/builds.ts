import { workspaceDir } from './paths.ts';
import Anthropic from '@anthropic-ai/sdk';
import {
  ClaudeAdapter, ProviderLimitError, sdkTransport,
  type ClaudeCall, type ClaudeMessage, type ClaudeTransport, type ModelCaller,
} from '../adapters/claude.ts';
import { fetchPost, geminiTransport } from '../adapters/gemini.ts';
import { openAiEndpointFrom, openAiTransport } from '../adapters/openai.ts';
import { BUILDER_SYSTEM_PROMPT, FeatureBuilder } from '../build/build-loop.ts';
import { INSTALL_COMMAND, LIVE_CHECKS, TEMPLATE_GUIDE, writeTemplate } from '../build/template.ts';
import { Verifier, type CheckSpec } from '../build/verifier.ts';
import { Workspace } from '../build/workspace.ts';
import type { RunLog } from '../calibration/runs.ts';
import { PgEventLog } from '../db/pg-event-log.ts';
import { PgGateStore } from '../db/pg-gate-store.ts';
import { PgRunLog } from '../db/pg-run-log.ts';
import { PgToolLog } from '../db/pg-tool-log.ts';
import type { DbScope } from '../db/scope.ts';
import type { Phase } from '../estimator/estimator.ts';
import type { ActivityEvent, EventType } from '../events/event-store.ts';
import { BudgetBlockedError, BudgetGate } from '../gate/budget-gate.ts';
import { Negotiator, type Decision } from '../relay/negotiator.ts';
import {
  approxTokens, ARCHITECT_SYSTEM, architectPrompt, phaseCall, phaseOfTask, RELAY_TASK, RelayCaller, REVIEW_SYSTEM,
  reviewPrompt, reviewTaskId, SPEC_SYSTEM, specPrompt, textOf, tokensOf, verdictOf,
} from '../relay/relay.ts';
import { FallbackCaller } from '../relay/fallback.ts';
import { db } from './db.ts';
import { liveModeStatus } from './live-mode.ts';
import { liveBlocker, planFor, registry } from './plan.ts';
import { getProject, setProjectState, verifiedTasks, type Project } from './projects.ts';
import { userScope } from './session.ts';
import { recordProjectChecks, runProjectChecks } from './verification.ts';
import { featureSlug, taskIdFor } from '../spec/acceptance.ts';

// Runs a project's build in the background of the server process: one feature after
// another through the build loop. A budget block pauses it; approving the request
// starts it again. Finished features are skipped, and earlier turns of an interrupted
// feature replay from the Gate and the tool log, which live in Postgres, so a build can
// also be resumed after the server restarts.
//
// Builds call real models through a provider adapter (and so the Budget Gate), work on
// the Next.js template, run the real checks, and log calibration runs. With a relay, a
// spec model and an architect model write briefs first, a review model reads each
// verified feature, and the negotiator splits the cap between the phases.

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

function liveSetup(provider: string): ModeSetup {
  return {
    // Provider keys stay in the server process and are never passed to the workspace.
    transport: provider === 'google'
      ? geminiTransport(fetchPost(process.env.GEMINI_API_KEY ?? ''))
      : provider === 'openai'
        ? openAiTransport(openAiEndpointFrom(process.env)!)
        : sdkTransport(new Anthropic()),
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

/** Calls a phase's model, retrying a failed call under a new key (its old key cannot replay). */
async function callPhase(caller: ModelCaller, call: ClaudeCall): Promise<ClaudeMessage> {
  let last: unknown;
  for (let retry = 0; retry <= 2; retry++) {
    try {
      return await caller.call(retry ? { ...call, idempotencyKey: `${call.idempotencyKey}:r${retry}` } : call);
    } catch (err) {
      if (err instanceof BudgetBlockedError || err instanceof ProviderLimitError) throw err;
      last = err;
    }
  }
  throw last;
}

/** Up to four files a feature's build wrote, from the event log. */
function writtenFiles(evts: ActivityEvent[], taskId: string): string[] {
  const paths = evts
    .filter((e) => e.taskId === taskId && e.type === 'tool_executed' && e.payload.tool === 'write_file' && !e.payload.isError)
    .map((e) => String(e.payload.path));
  return [...new Set(paths)].slice(-4);
}

async function runBuild(projectId: string, userId: string): Promise<void> {
  const scope = await userScope(userId);
  const project = await getProject(projectId, userId);
  if (!project) throw new Error('project not found');
  if (project.buildMode !== 'live') throw new Error('This project still uses the retired simulated build. Switch it to live mode before starting.');
  const buildModel = project.spec.buildModel;
  const provider = registry.get(buildModel).provider;
  const live = liveModeStatus(process.env, provider);
  if (!live.available) throw new Error(`live builds are not enabled on this server: ${live.missing.join('; ')}`);

  const gate = gateFor(scope);
  const budget = await gate.getBudget(projectId);
  const events = new PgEventLog(db(), scope);
  const mode = liveSetup(provider);
  const workspace = new Workspace(workspaceDir(projectId));

  // One adapter per vendor whose key is configured. A relay phase on any other vendor runs
  // on the build model instead, and the substitution is recorded.
  const adapters: Partial<Record<string, ClaudeAdapter>> = {};
  for (const p of ['anthropic', 'google', 'openai']) {
    if (liveModeStatus(process.env, p).available) adapters[p] = new ClaudeAdapter(gate, registry, liveSetup(p).transport, p);
  }

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
  const relay = project.spec.relay ?? null;
  const v = `v${project.specVersion}`;

  // A resumed build replays its calls from the Gate, and with them the negotiation, so each
  // relay event is recorded once per spec version.
  const recorded = new Set((await events.list(projectId)).map((e) => e.payload.key).filter(Boolean));
  const once = async (key: string, type: EventType, taskId: string | null, payload: Record<string, unknown>) => {
    const k = `${v}:${key}`;
    if (recorded.has(k)) return;
    recorded.add(k);
    await events.append({ projectId, taskId, type, payload: { key: k, ...payload } });
  };

  const buildLines = paid.lines.filter((l) => l.phase === 'build' && l.range);
  const expected = plan.relay
    ? plan.relay.phases.map((p) => ({ phase: p.phase, expected: p.range.expected }))
    : [{ phase: 'build' as Phase, expected: buildLines.reduce((t, l) => t + l.range!.expected, 0) }];
  const negotiator = Negotiator.fromPlan(budget.projectCap, expected);
  await once('budget', 'relay_budget', null, { cap: budget.projectCap, ...negotiator.snapshot() });
  let decisionNo = 0;
  const onDecision = (d: Decision) =>
    once(`negotiation:${decisionNo++}`, 'negotiation', null, { ...d, after: negotiator.snapshot() });
  // A Gemini model whose free quota runs out mid-build hands its calls to the next one.
  const caller = new FallbackCaller(new RelayCaller({ adapters, registry, negotiator, onDecision }), (s) =>
    events.append({
      projectId, taskId: null, type: 'relay_substituted',
      payload: { phase: phaseOfTask(s.taskId), planned: s.from, used: s.to, reason: s.reason },
    }).then(() => undefined));

  const modelFor = async (phase: Exclude<Phase, 'build'>): Promise<string> => {
    const planned = relay![phase];
    const vendor = registry.get(planned).provider;
    if (adapters[vendor]) return planned;
    await once(`substituted:${phase}`, 'relay_substituted', null, {
      phase, planned, used: buildModel, reason: liveBlocker(vendor) ?? `No ${vendor} key on this server`,
    });
    return buildModel;
  };
  const finishPhase = async (phase: Phase, model: string, extra: Record<string, unknown> = {}) => {
    const d = negotiator.finish(phase);
    if (d) await onDecision(d);
    await once(`finished:${phase}`, 'relay_phase_finished', null, {
      // The model that last ran the phase, after any quota or overload switch.
      phase, model: caller.current(model) ?? model, spent: negotiator.phases.get(phase)?.spent ?? 0, ...extra,
    });
  };
  const pause = () => setProjectState(projectId, 'paused', userId);

  let architectBrief = '';
  let reviewModel = buildModel;
  try {
    if (relay) {
      // Spec: the owner's words become a brief for the architect.
      const specModel = await modelFor('spec');
      await once('started:spec', 'relay_phase_started', RELAY_TASK.spec, { phase: 'spec', model: specModel });
      const specMsg = await callPhase(caller, phaseCall({
        projectId, taskId: RELAY_TASK.spec, idempotencyKey: `${projectId}:${v}:spec`, description: 'Spec brief',
        model: specModel, system: SPEC_SYSTEM, prompt: specPrompt(project.spec.idea, project.spec.features),
        maxTokens: 2_000, taskCeiling: budget.projectCap,
      }));
      const specBrief = textOf(specMsg);
      const specTokens = tokensOf(specMsg);
      await finishPhase('spec', specModel, { tokens: specTokens });

      // Architect: works from the spec brief, never the spec phase's transcript.
      const archModel = await modelFor('architect');
      await once('handoff:spec', 'relay_handoff', RELAY_TASK.architect, {
        from: 'spec', to: 'architect', fromModel: specModel, toModel: archModel, brief: specBrief.slice(0, 6_000),
        briefTokens: specTokens.output, historyTokens: specTokens.input + specTokens.output,
      });
      await once('started:architect', 'relay_phase_started', RELAY_TASK.architect, { phase: 'architect', model: caller.current(archModel) ?? archModel });
      const archMsg = await callPhase(caller, phaseCall({
        projectId, taskId: RELAY_TASK.architect, idempotencyKey: `${projectId}:${v}:architect`, description: 'Technical brief',
        model: archModel, system: ARCHITECT_SYSTEM, prompt: architectPrompt(specBrief),
        maxTokens: 3_000, taskCeiling: budget.projectCap,
      }));
      architectBrief = textOf(archMsg);
      const archTokens = tokensOf(archMsg);
      await finishPhase('architect', archModel, { tokens: archTokens });
      await once('handoff:architect', 'relay_handoff', null, {
        from: 'architect', to: 'build', fromModel: archModel, toModel: buildModel, brief: architectBrief.slice(0, 6_000),
        briefTokens: archTokens.output,
        // What each build call would carry without briefs: both phases' transcripts.
        historyTokens: specTokens.input + specTokens.output + archTokens.input + archTokens.output,
      });
      reviewModel = await modelFor('review');
    }

    await once('started:build', 'relay_phase_started', null, { phase: 'build', model: caller.current(buildModel) ?? buildModel });
    for (const feature of project.spec.features) {
      // Stable per name, type and criteria: unchanged features stay done across spec edits.
      const taskId = taskIdFor(feature);
      if (done.has(taskId)) continue;
      const slug = featureSlug(feature.name);
      const quoted = paid.lines.find((l) => l.label === `Build: ${feature.name}`)?.range;
      const builder = new FeatureBuilder({
        adapter: caller, workspace, events, tools, runs: mode.runs,
        verifier: new Verifier(mode.checksFor(slug)),
        systemPrompt: mode.systemPrompt,
      });
      const out = await builder.build({
        projectId, taskId, featureType: feature.type, featureName: feature.name,
        spec: `${project.spec.idea}\n\nBuild the "${feature.name}" feature.`
          + (architectBrief ? `\n\nTechnical brief from the architect (follow it):\n${architectBrief}` : ''),
        acceptance: mode.acceptance(slug, feature.acceptance),
        model: buildModel,
        taskCeiling: budget.projectCap,
        retryLimit: 2,
        retryCostLimit: budget.projectCap,
        maxTurns: mode.maxTurns,
        maxTokens: mode.maxTokens,
        effort: 'high',
        ...(quoted ? { quoted: { low: quoted.low, high: quoted.high } } : {}),
      });
      if (out.status !== 'verified') return pause();

      if (relay) {
        // Review: a separate model reads the feature's code and check results, not its transcript.
        const files: Array<{ path: string; content: string }> = [];
        for (const path of writtenFiles(await events.list(projectId), taskId)) {
          const content = await workspace.read(path).catch(() => '');
          if (content) files.push({ path, content: content.length > 12_000 ? `${content.slice(0, 12_000)}
[clipped by MAKABL at 12,000 characters; the file continues]` : content });
        }
        const prompt = reviewPrompt({ feature: feature.name, acceptance: feature.acceptance, checks: out.checks, files });
        const t = out.run.tokens;
        await once(`handoff:review:${taskId}`, 'relay_handoff', reviewTaskId(taskId), {
          from: 'build', to: 'review', feature: feature.name, fromModel: buildModel, toModel: reviewModel,
          brief: `${files.length} file(s) and ${out.checks.length} check result(s)`,
          briefTokens: approxTokens(prompt),
          historyTokens: t.input + t.output + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h,
        });
        await once('started:review', 'relay_phase_started', null, { phase: 'review', model: caller.current(reviewModel) ?? reviewModel });
        try {
          const msg = await callPhase(caller, phaseCall({
            projectId, taskId: reviewTaskId(taskId), idempotencyKey: `${projectId}:${v}:review:${taskId}`,
            description: `Review: ${feature.name}`, model: reviewModel, system: REVIEW_SYSTEM, prompt,
            maxTokens: 1_200, taskCeiling: budget.projectCap,
          }));
          const review = textOf(msg);
          await once(`review:${taskId}`, 'relay_review', reviewTaskId(taskId), {
            feature: feature.name, model: reviewModel, verdict: verdictOf(review), review: review.slice(0, 3_000),
          });
        } catch (err) {
          if (err instanceof BudgetBlockedError) throw err;
          // The checks already passed; a review that could not run is recorded, not fatal.
          await once(`review:${taskId}`, 'relay_review', reviewTaskId(taskId), {
            feature: feature.name, model: reviewModel, verdict: null,
            review: `Review could not run: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    }
    await finishPhase('build', buildModel);
    if (relay) await finishPhase('review', reviewModel);
  } catch (err) {
    // Pause, do not kill: approving the request resumes, replaying finished calls for free.
    if (err instanceof BudgetBlockedError) return pause();
    if (err instanceof ProviderLimitError) {
      await events.append({ projectId, taskId: null, type: 'task_failed', payload: { reason: err.message } });
      return pause();
    }
    throw err;
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
