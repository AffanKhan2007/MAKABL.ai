'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { PgEventLog } from '../../../src/db/pg-event-log.ts';
import { usd } from '../../../src/domain/types.ts';
import { gate, isRunning, startBuild } from '../../../src/server/builds.ts';
import { db } from '../../../src/server/db.ts';
import { liveModeStatus } from '../../../src/server/live-mode.ts';
import { planFor } from '../../../src/server/plan.ts';
import { purgeProject } from '../../../src/server/purge.ts';
import { getProject, recordPlanApproval, setBuildMode, setProjectState } from '../../../src/server/projects.ts';
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

/** Delete the project and everything recorded about it (NFR-11), after typed confirmation. */
export async function deleteProjectAction(projectId: string, form: FormData): Promise<void> {
  const project = await getProject(projectId);
  if (!project) return back(projectId, 'Project not found.');
  if (isRunning(projectId)) return back(projectId, 'Wait for the build to pause or finish before deleting.');
  if (String(form.get('confirm') ?? '').trim() !== project.name) {
    return back(projectId, 'Type the project name exactly to confirm deletion.');
  }
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
