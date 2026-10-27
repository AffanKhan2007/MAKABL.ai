'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { usd } from '../../../src/domain/types.ts';
import { gate, isRunning, startBuild } from '../../../src/server/builds.ts';
import { planFor } from '../../../src/server/plan.ts';
import { getProject, recordPlanApproval, setProjectState } from '../../../src/server/projects.ts';

// Every action re-reads the project and checks its state, so a stale page or a replayed
// form cannot approve, build or decide out of order.

const back = (id: string, error?: string): never =>
  redirect(`/projects/${id}${error ? `?error=${encodeURIComponent(error)}` : ''}`);

/** Dollars from a form field, as micros; null if missing or out of range. */
function dollars(form: FormData, key: string, max: number): number | null {
  const n = Number(String(form.get(key) ?? '').trim());
  return Number.isFinite(n) && n > 0 && n <= max ? usd(n) : null;
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
  await gate().setBudget(projectId, { projectCap, monthlyCap });
  await recordPlanApproval(projectId, {
    specVersion: project.specVersion,
    caps: { projectCap, monthlyCap, currency: 'USD' },
    horizon: plan.horizon,
    totals: plan.paths.map((p) => ({ path: p.path, eligible: p.eligible, totals: p.totals })),
  });
  await setProjectState(projectId, 'approved');
  revalidatePath(`/projects/${projectId}`);
  back(projectId);
}

export async function startBuildAction(projectId: string): Promise<void> {
  const project = await getProject(projectId);
  if (!project) return back(projectId, 'Project not found.');
  if (project.state !== 'approved' && project.state !== 'paused') {
    return back(projectId, 'Approve the cost plan before building.');
  }
  if ((await gate().pendingApprovals(projectId)).length > 0) {
    return back(projectId, 'Decide the pending approval first.');
  }
  if (!isRunning(projectId)) startBuild(projectId);
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
  try {
    await gate().decide(projectId, approvalId, decision, raiseBy);
  } catch (err) {
    return back(projectId, err instanceof Error ? err.message : 'Could not record the decision.');
  }
  if (decision === 'approved' && !isRunning(projectId)) startBuild(projectId);
  revalidatePath(`/projects/${projectId}`);
  back(projectId);
}
