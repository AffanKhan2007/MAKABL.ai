import { priceMessage, ProviderLimitError } from '../adapters/claude.ts';
import { PgEventLog } from '../db/pg-event-log.ts';
import { BudgetBlockedError } from '../gate/budget-gate.ts';
import { extractHtml, RENDER_SYSTEM, renderPrompt, sanitizeHtml, wireframeOf } from '../relay/render.ts';
import { textOf, tokensOf } from '../relay/relay.ts';
import { buildAdapters, gateFor, isRunning } from './builds.ts';
import { db } from './db.ts';
import { liveBlocker, modelLabel, registry } from './plan.ts';
import { getProject } from './projects.ts';
import { userScope } from './session.ts';

// Renders (see src/relay/render.ts). Asking for one is a paid model call like any other, so
// it goes through the Budget Gate under the project's approved cap, and every render is
// recorded in the event log with the model, the tokens, the cost and what the user asked for.

export const MAX_RENDERS = 12;
export const MAX_FEEDBACK = 500;

export interface RenderRecord {
  n: number;
  page: string;
  feedback: string | null;
  model: string;
  html: string;
  tokens: { input: number; output: number };
  cost: number;
  at: string;
}

/** Every render of a project, oldest first, from the event log. */
export async function listRenders(projectId: string, userId?: string): Promise<RenderRecord[]> {
  const events = await new PgEventLog(db(), await userScope(userId)).list(projectId);
  return events.filter((e) => e.type === 'relay_render').map((e) => ({
    n: Number(e.payload.n), page: String(e.payload.page), feedback: (e.payload.feedback as string | null) ?? null,
    model: String(e.payload.model), html: String(e.payload.html), tokens: e.payload.tokens as RenderRecord['tokens'],
    cost: Number(e.payload.cost), at: e.at,
  }));
}

/**
 * Draw one render. `feedback` asks for a change to the latest render of the same page.
 * Returns an error in words the user can act on, never a stack trace.
 */
export async function generateRender(opts: {
  projectId: string; userId: string; page: string; feedback: string;
}): Promise<{ error: string } | { n: number }> {
  const project = await getProject(opts.projectId, opts.userId);
  if (!project) return { error: 'Project not found.' };
  if (isRunning(opts.projectId)) return { error: 'A build is running. Ask for a render when it pauses or finishes.' };

  const scope = await userScope(opts.userId);
  const gate = gateFor(scope);
  const budget = await gate.getBudget(opts.projectId).catch(() => null);
  if (!budget) return { error: 'Approve the plan and set your spending limit first, so renders count against it.' };

  const events = new PgEventLog(db(), scope);
  const all = await events.list(opts.projectId);
  const renders = all.filter((e) => e.type === 'relay_render');
  if (renders.length >= MAX_RENDERS) return { error: `That is ${MAX_RENDERS} renders, the most one project keeps.` };
  const n = renders.length + 1;

  // The architect's wireframe, if a build has produced one, and the last version of this page.
  const handoff = [...all].reverse().find((e) => e.type === 'relay_handoff' && e.payload.from === 'architect');
  const wireframe = handoff ? wireframeOf(String(handoff.payload.brief ?? '')) : undefined;
  const previous = [...renders].reverse().find((e) => e.payload.page === opts.page);

  // The architect's model if its vendor is set up here, else the build model.
  const adapters = buildAdapters(gate);
  const wanted = [project.spec.relay?.architect, project.spec.buildModel].filter((m): m is string => !!m);
  const model = wanted.find((m) => adapters[registry.get(m).provider]);
  if (!model) {
    const vendor = registry.get(project.spec.buildModel).provider;
    return { error: `No model is connected for renders. ${liveBlocker(vendor) ?? ''}`.trim() };
  }
  const price = registry.get(model);

  let msg;
  try {
    msg = await adapters[price.provider]!.call({
      projectId: opts.projectId, taskId: `render:${n}`, taskCeiling: budget.projectCap,
      idempotencyKey: `${opts.projectId}:render:${n}`, description: `Render ${n}: ${opts.page}`,
      model, system: RENDER_SYSTEM, maxTokens: 7_000, effort: 'low',
      messages: [{
        role: 'user',
        content: renderPrompt({
          idea: project.spec.idea, page: opts.page, features: project.spec.features,
          ...(wireframe ? { wireframe } : {}),
          ...(previous ? { previous: String(previous.payload.html) } : {}),
          ...(opts.feedback ? { feedback: opts.feedback } : {}),
        }),
      }],
    });
  } catch (err) {
    if (err instanceof BudgetBlockedError) return { error: 'This would pass your spending limit. Raise the limit on the project page, then try again.' };
    if (err instanceof ProviderLimitError) return { error: err.message };
    return { error: `The model call failed: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown error'}` };
  }

  const html = extractHtml(textOf(msg));
  if (!html) return { error: `${modelLabel(model)} did not return a page. Try again, or describe the page differently.` };
  const cost = priceMessage(msg, price, registry, price.provider).cost;
  await events.append({
    projectId: opts.projectId, taskId: `render:${n}`, type: 'relay_render',
    payload: {
      n, page: opts.page, feedback: opts.feedback || null, model, html: sanitizeHtml(html),
      tokens: tokensOf(msg), cost,
    },
  });
  return { n };
}

/** Mark a render as the look the build must match. The latest mark wins. */
export async function chooseRender(opts: { projectId: string; userId: string; n: number }): Promise<{ error: string } | { n: number }> {
  const renders = await listRenders(opts.projectId, opts.userId);
  const render = renders.find((r) => r.n === opts.n);
  if (!render) return { error: 'That version no longer exists.' };
  await new PgEventLog(db(), await userScope(opts.userId)).append({
    projectId: opts.projectId, taskId: null, type: 'relay_render_chosen', payload: { n: render.n, page: render.page },
  });
  return { n: render.n };
}

/** The version the owner chose, if any. */
export async function chosenN(projectId: string, userId?: string): Promise<number | null> {
  const events = await new PgEventLog(db(), await userScope(userId)).list(projectId);
  const mark = [...events].reverse().find((e) => e.type === 'relay_render_chosen');
  return mark ? Number(mark.payload.n) : null;
}
