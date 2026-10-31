'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { PgEventLog } from '../../../src/db/pg-event-log.ts';
import { usd } from '../../../src/domain/types.ts';
import { gate, isRunning, startBuild } from '../../../src/server/builds.ts';
import { db } from '../../../src/server/db.ts';
import { liveModeStatus } from '../../../src/server/live-mode.ts';
import { liveBlocker, modelLabel, planFor, PRESETS, registry, withPreset, type PresetId } from '../../../src/server/plan.ts';
import { parseWhatIf, whatIf, type WhatIfState } from '../../../src/server/what-if.ts';
import { diffSpecs } from '../../../src/spec/diff.ts';
import { purgeProject } from '../../../src/server/purge.ts';
import { startPreview, stopPreview } from '../../../src/build/preview.ts';
import { workspaceDir } from '../../../src/server/paths.ts';
import { getProject, recordPlanApproval, saveSpecVersion, setBuildMode, setProjectState } from '../../../src/server/projects.ts';
import { currentUserId, userScope } from '../../../src/server/session.ts';

// Every action re-reads the project as the current user and checks its state, so a
// stale page or a replayed form cannot approve, build or decide out of order, and a
// project id that is not the user's is simply not found.

const back = (id: string, error?: string): never =>
  redirect(`/projects/${id}${error ? `?error=${encodeURIComponent(error)}` : ''}`);

/** Dollars from a form field, as micros; null if missing or out of range. */
function dollars(form: FormData, key: string, max: number): number | null {
  const n = Number(String(form.get(key) ?? '').trim());
  return Number.isFinite(n) && n > 0 && n <= max ? usd(n) : null;
}

/** Run the app a live build produced (#15); waits until it answers or fails. */
export async function startPreviewAction(projectId: string): Promise<void> {
  const project = await getProject(projectId);
  if (!project) return back(projectId, 'Project not found.');
  if (project.buildMode !== 'live') return back(projectId, 'Only live builds produce an app to run.');
  if (isRunning(projectId)) return back(projectId, 'Wait for the build to finish first.');
  const p = await startPreview(projectId, workspaceDir(projectId));
  revalidatePath(`/projects/${projectId}`);
  back(projectId, p.status === 'running' ? undefined : 'The app did not start. Its output is shown below.');
}

export async function stopPreviewAction(projectId: string): Promise<void> {
  if (!(await getProject(projectId))) return back(projectId, 'Project not found.');
  stopPreview(projectId);
  revalidatePath(`/projects/${projectId}`);
  back(projectId);
}

/** Delete the project and everything recorded about it (NFR-11), after typed confirmation. */
export async function deleteProjectAction(projectId: string, form: FormData): Promise<void> {
  const project = await getProject(projectId);
  if (!project) return back(projectId, 'Project not found.');
  if (isRunning(projectId)) return back(projectId, 'Wait for the build to pause or finish before deleting.');
  if (String(form.get('confirm') ?? '').trim() !== project.name) {
    return back(projectId, 'Type the project name exactly to confirm deletion.');
  }
  stopPreview(projectId);
  await purgeProject(projectId);
  revalidatePath('/projects');
  redirect('/projects');
}

export async function approvePlanAction(projectId: string, form: FormData): Promise<void> {
  const project = await getProject(projectId);
  if (!project) return back(projectId, 'Project not found.');
  if (project.state !== 'costed') return back(projectId, 'This plan has already been approved.');
  const projectCap = dollars(form, 'projectCap', 10_000);
  const monthlyCap = dollars(form, 'monthlyCap', 10_000);
  if (projectCap === null || monthlyCap === null) {
    return back(projectId, 'Caps must be amounts between $0.01 and $10,000.');
  }
  const plan = await planFor(project.spec);
  await (await gate()).setBudget(projectId, { projectCap, monthlyCap });
  await recordPlanApproval(projectId, {
    specVersion: project.specVersion,
    buildMode: project.buildMode,
    caps: { projectCap, monthlyCap, currency: 'USD' },
    horizon: plan.horizon,
    totals: plan.paths.map((p) => ({ path: p.path, eligible: p.eligible, totals: p.totals })),
  });
  await setProjectState(projectId, 'approved');
  revalidatePath(`/projects/${projectId}`);
  back(projectId);
}

/** Resumable states: approved, paused, or "building" left behind by a server restart. */
const canStart = (state: string, projectId: string) =>
  state === 'approved' || state === 'paused' || (state === 'building' && !isRunning(projectId));

export async function startBuildAction(projectId: string): Promise<void> {
  const project = await getProject(projectId);
  if (!project) return back(projectId, 'Project not found.');
  if (!canStart(project.state, projectId)) return back(projectId, 'Approve the cost plan before building.');
  if ((await (await gate()).pendingApprovals(projectId)).length > 0) {
    return back(projectId, 'Decide the pending approval first.');
  }
  if (project.buildMode === 'live' && !liveModeStatus().available) {
    return back(projectId, 'Live builds are not enabled on this server.');
  }
  if (project.buildMode === 'live') {
    const blocked = liveBlocker(registry.get(project.spec.buildModel).provider);
    if (blocked) return back(projectId, `Cannot build live on ${modelLabel(project.spec.buildModel)}: ${blocked}.`);
  }
  startBuild(projectId, await currentUserId());
  revalidatePath(`/projects/${projectId}`);
  back(projectId);
}

export async function decideApprovalAction(projectId: string, approvalId: string, form: FormData): Promise<void> {
  const project = await getProject(projectId);
  if (!project) return back(projectId, 'Project not found.');
  const decision = form.get('decision') === 'approved' ? 'approved' : 'declined';
  let raiseBy = 0;
  if (decision === 'approved') {
    const raise = dollars(form, 'raiseBy', 10_000);
    if (raise === null) return back(projectId, 'Enter how much to raise the cap by, up to $10,000.');
    raiseBy = raise;
  }
  const userId = await currentUserId();
  try {
    await (await gate()).decide(projectId, approvalId, decision, raiseBy, userId);
  } catch (err) {
    return back(projectId, err instanceof Error ? err.message : 'Could not record the decision.');
  }
  if (decision === 'approved') startBuild(projectId, userId);
  revalidatePath(`/projects/${projectId}`);
  back(projectId);
}

/**
 * Switch between simulated and live builds. Only before any build spend, so a project's
 * ledger never mixes simulated and real charges. Going live needs the server enabled
 * for it and an explicit confirmation.
 */
export async function setBuildModeAction(projectId: string, form: FormData): Promise<void> {
  const project = await getProject(projectId);
  if (!project) return back(projectId, 'Project not found.');
  const mode = form.get('mode') === 'live' ? 'live' : 'simulated';
  if (mode === project.buildMode) return back(projectId);
  if (isRunning(projectId) || (await (await gate()).ledgerFor(projectId).catch(() => [])).length > 0) {
    return back(projectId, 'The build mode can only change before the build has spent anything. Start a new project instead.');
  }
  if (mode === 'live') {
    if (!liveModeStatus().available) return back(projectId, 'Live builds are not enabled on this server.');
    if (form.get('confirm') !== 'yes') {
      return back(projectId, 'Tick the box to confirm that live builds spend real money and run generated code on this computer.');
    }
  }
  await setBuildMode(projectId, mode);
  await new PgEventLog(db(), await userScope()).append({
    projectId, taskId: null, type: 'build_mode_changed', payload: { mode },
  });
  revalidatePath(`/projects/${projectId}`);
  back(projectId);
}

/** Recompute the plan for the explorer's settings. Saves nothing. */
export async function whatIfAction(projectId: string, _prev: WhatIfState, form: FormData): Promise<WhatIfState> {
  const project = await getProject(projectId);
  if (!project) return { result: null, error: 'Project not found.' };
  const parsed = parseWhatIf(project.spec, form);
  if ('error' in parsed) return { result: null, error: parsed.error };
  const [baseline, budget] = await Promise.all([planFor(project.spec), (await gate()).getBudget(projectId).catch(() => null)]);
  const result = await whatIf(parsed.spec, baseline.paths[1].totals.expected, {
    ...(budget ? { capMicros: budget.projectCap } : {}),
    live: project.buildMode === 'live',
  }, parsed.overrides);
  return { result, error: null };
}

/** Save the explorer's settings as the next spec version; the plan then needs approving again. */
export async function applyWhatIfAction(projectId: string, form: FormData): Promise<void> {
  const project = await getProject(projectId);
  if (!project) return back(projectId, 'Project not found.');
  if (isRunning(projectId)) return back(projectId, 'Wait for the build to pause or finish before changing the plan.');
  const parsed = parseWhatIf(project.spec, form);
  if ('error' in parsed) return back(projectId, parsed.error);
  const diff = diffSpecs(project.spec, parsed.spec);
  if (!diff.settings.length) return back(projectId);
  const version = await saveSpecVersion(projectId, project.name, parsed.spec);
  await new PgEventLog(db(), await userScope()).append({
    projectId, taskId: null, type: 'spec_changed',
    payload: { fromVersion: project.specVersion, toVersion: version, added: [], removed: [], changed: [], settings: diff.settings },
  });
  revalidatePath(`/projects/${projectId}`);
  back(projectId);
}

/** Easy mode: switch the project to one of the three quality levels, as a new spec version. */
export async function applyPresetAction(projectId: string, form: FormData): Promise<void> {
  const project = await getProject(projectId);
  if (!project) return back(projectId, 'Project not found.');
  if (isRunning(projectId)) return back(projectId, 'Wait for the build to pause or finish before changing the plan.');
  const id = String(form.get('preset') ?? '');
  if (!(id in PRESETS)) return back(projectId, 'Pick Budget, Balanced or Best quality.');
  const spec = withPreset(project.spec, id as PresetId);
  const diff = diffSpecs(project.spec, spec);
  if (!diff.settings.length) return back(projectId);
  const version = await saveSpecVersion(projectId, project.name, spec);
  await new PgEventLog(db(), await userScope()).append({
    projectId, taskId: null, type: 'spec_changed',
    payload: { fromVersion: project.specVersion, toVersion: version, added: [], removed: [], changed: [], settings: diff.settings },
  });
  revalidatePath(`/projects/${projectId}`);
  back(projectId);
}
