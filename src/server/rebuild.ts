import { PgEventLog } from '../db/pg-event-log.ts';
import { designFor, designTargets } from '../relay/render.ts';
import { gate, isRunning, startBuild } from './builds.ts';
import { db } from './db.ts';
import { getProject, setProjectState } from './projects.ts';
import { chooseRender } from './renders.ts';
import { userScope } from './session.ts';

/**
 * Build again, with new model calls. With `render`, that version becomes the chosen look and only
 * the features it governs are rebuilt; with `features`, only those; with neither, every feature.
 * Returns a message when it cannot start.
 */
export async function requestRebuild(opts: { projectId: string; userId: string; features?: string[]; render?: number }): Promise<string | null> {
  const project = await getProject(opts.projectId, opts.userId);
  if (!project) return 'Project not found.';
  if (isRunning(opts.projectId)) return 'A build is already running.';
  if (!['verifying', 'paused', 'approved'].includes(project.state)) return 'Build the app once before rebuilding it.';
  if ((await (await gate()).pendingApprovals(opts.projectId)).length > 0) return 'Decide the pending approval first.';
  const events = new PgEventLog(db(), await userScope(opts.userId));

  let features: string[] | 'all' = opts.features?.length ? opts.features : 'all';
  if (opts.render !== undefined) {
    const chosen = await chooseRender({ projectId: opts.projectId, userId: opts.userId, n: opts.render });
    if ('error' in chosen) return chosen.error;
    const designs = designTargets(await events.list(opts.projectId));
    const governed = project.spec.features.filter((f) => designFor(designs, f.name)?.n === opts.render).map((f) => f.name);
    features = governed.length ? governed : 'all';
  }
  await events.append({ projectId: opts.projectId, taskId: null, type: 'rebuild_requested', payload: { v: `v${project.specVersion}`, features, render: opts.render ?? null } });
  await setProjectState(opts.projectId, 'paused', opts.userId);
  startBuild(opts.projectId, opts.userId);
  return null;
}
