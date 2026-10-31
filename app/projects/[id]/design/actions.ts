'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isRunning } from '../../../../src/server/builds.ts';
import { requestMockup } from '../../../../src/server/design.ts';
import { getProject } from '../../../../src/server/projects.ts';

const page = (id: string, q?: Record<string, string>) =>
  redirect(`/projects/${id}/design${q ? `?${new URLSearchParams(q)}` : ''}`);

/** Draw the first mockup, or another version with the owner's requested change. */
export async function drawMockupAction(projectId: string, form: FormData): Promise<void> {
  const project = await getProject(projectId);
  if (!project) return page(projectId, { error: 'Project not found.' });
  if (isRunning(projectId)) return page(projectId, { error: 'Wait for the build to pause or finish first.' });
  const base = Number(form.get('base'));
  const out = await requestMockup(project, String(form.get('feedback') ?? ''), Number.isInteger(base) && base > 0 ? base : undefined);
  revalidatePath(`/projects/${projectId}/design`);
  revalidatePath(`/projects/${projectId}`);
  if (!out.ok) return page(projectId, { error: out.error });
  page(projectId, { v: String(out.render.version) });
}
