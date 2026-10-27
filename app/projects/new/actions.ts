'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { parseIntake } from '../../../src/server/intake.ts';
import { createProject } from '../../../src/server/projects.ts';

export interface IntakeState {
  error: string | null;
}

export async function createProjectAction(_prev: IntakeState, form: FormData): Promise<IntakeState> {
  const parsed = parseIntake(form);
  if ('error' in parsed) return { error: parsed.error };
  const id = await createProject(parsed.name, parsed.spec);
  revalidatePath('/');
  redirect(`/projects/${id}`);
}
