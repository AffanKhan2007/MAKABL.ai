'use server';

import { revalidatePath } from 'next/cache';
import { PgEventLog } from '../../../../src/db/pg-event-log.ts';
import { isRunning, startBuild } from '../../../../src/server/builds.ts';
import { db } from '../../../../src/server/db.ts';
import { getProject } from '../../../../src/server/projects.ts';
import { currentUserId, userScope } from '../../../../src/server/session.ts';

async function log(projectId: string) {
  const project = await getProject(projectId);
  if (!project) return null;
  return { project, events: new PgEventLog(db(), await userScope()), v: `v${project.specVersion}` };
}

/** An instruction for the builder, for one feature or for all of them. Picked up by the next feature built. */
export async function addNoteAction(projectId: string, form: FormData): Promise<void> {
  const text = String(form.get('text') ?? '').trim().slice(0, 600);
  const feature = String(form.get('feature') ?? '').trim().slice(0, 80) || null;
  const l = await log(projectId);
  if (!l || !text) return;
  await l.events.append({ projectId, taskId: null, type: 'owner_note', payload: { v: l.v, feature, text } });
  revalidatePath(`/projects/${projectId}/steer`);
}

/** How often the build stops for the owner. */
export async function setCheckpointAction(projectId: string, form: FormData): Promise<void> {
  const level = ['none', 'brief', 'feature'].includes(String(form.get('level'))) ? String(form.get('level')) : 'brief';
  const l = await log(projectId);
  if (!l) return;
  await l.events.append({ projectId, taskId: null, type: 'owner_checkpoint', payload: { level } });
  revalidatePath(`/projects/${projectId}/steer`);
}

/** Save an edited architect brief (if changed), approve the stop, and carry on building. */
export async function continueAction(projectId: string, stage: string, form: FormData): Promise<void> {
  const l = await log(projectId);
  if (!l) return;
  const brief = String(form.get('brief') ?? '').trim().slice(0, 8_000);
  const original = String(form.get('original') ?? '').trim();
  if (brief && brief !== original) {
    await l.events.append({ projectId, taskId: null, type: 'owner_brief_edit', payload: { v: l.v, phase: 'architect', text: brief } });
  }
  await l.events.append({ projectId, taskId: null, type: 'owner_approved', payload: { v: l.v, stage } });
  if (!isRunning(projectId)) startBuild(projectId, await currentUserId());
  revalidatePath(`/projects/${projectId}`);
}
