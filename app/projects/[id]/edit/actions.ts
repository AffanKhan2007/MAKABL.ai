'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { PgEventLog } from '../../../../src/db/pg-event-log.ts';
import { diffSpecs } from '../../../../src/spec/diff.ts';
import { isRunning } from '../../../../src/server/builds.ts';
import { db } from '../../../../src/server/db.ts';
import { parseIntake } from '../../../../src/server/intake.ts';
import { getProject, saveSpecVersion } from '../../../../src/server/projects.ts';
import { userScope } from '../../../../src/server/session.ts';
import type { IntakeState } from '../../new/actions.ts';

/** Save a change request as a new spec version; the plan then needs approving again. */
export async function updateSpecAction(projectId: string, _prev: IntakeState, form: FormData): Promise<IntakeState> {
  const project = await getProject(projectId);
  if (!project) return { error: 'Project not found.' };
  if (isRunning(projectId)) return { error: 'Wait for the build to pause or finish before changing the spec.' };
  const parsed = parseIntake(form);
  if ('error' in parsed) return { error: parsed.error };
  // The intake form does not show the relay or the what-if assumptions; keep them.
  const { relay, retryRate, caching } = project.spec;
  parsed.spec = { ...parsed.spec, relay, retryRate, caching };

  const diff = diffSpecs(project.spec, parsed.spec);
  const nothing = !diff.added.length && !diff.removed.length && !diff.changed.length && !diff.settings.length
    && parsed.name === project.name;
  if (nothing) redirect(`/projects/${projectId}`);

  const version = await saveSpecVersion(projectId, parsed.name, parsed.spec);
  await new PgEventLog(db(), await userScope()).append({
    projectId, taskId: null, type: 'spec_changed',
    payload: {
      fromVersion: project.specVersion, toVersion: version,
      added: diff.added.map((f) => f.name), removed: diff.removed.map((f) => f.name),
      changed: diff.changed.map((c) => c.after.name), settings: diff.settings,
    },
  });
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}`);
}
