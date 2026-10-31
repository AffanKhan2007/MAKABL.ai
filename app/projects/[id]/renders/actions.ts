'use server';

import { revalidatePath } from 'next/cache';
import { generateRender, MAX_FEEDBACK } from '../../../../src/server/renders.ts';
import { currentUserId } from '../../../../src/server/session.ts';

export interface RenderState { error: string | null; done: number | null }

/** Ask for a render of a page, or for a change to the latest one. Costs a model call. */
export async function requestRenderAction(projectId: string, _prev: RenderState, form: FormData): Promise<RenderState> {
  const page = String(form.get('page') ?? '').trim().slice(0, 40) || 'Home';
  const feedback = String(form.get('feedback') ?? '').trim();
  if (feedback.length > MAX_FEEDBACK) return { error: `Keep the change request under ${MAX_FEEDBACK} characters.`, done: null };
  const result = await generateRender({ projectId, userId: await currentUserId(), page, feedback });
  if ('error' in result) return { error: result.error, done: null };
  revalidatePath(`/projects/${projectId}/renders`);
  return { error: null, done: result.n };
}
