import { randomUUID } from 'node:crypto';
import { ClaudeAdapter, priceMessage } from '../adapters/claude.ts';
import { PgEventLog } from '../db/pg-event-log.ts';
import { usd } from '../domain/types.ts';
import type { ActivityEvent } from '../events/event-store.ts';
import { BudgetBlockedError } from '../gate/budget-gate.ts';
import { DESIGN_TASK, designModel, drawMockup, MAX_FEEDBACK_CHARS, type DesignRender } from '../design/render.ts';
import { gateFor, transportFor } from './builds.ts';
import { db } from './db.ts';
import { registry } from './plan.ts';
import type { Project } from './projects.ts';
import { userScope } from './session.ts';

// Server side of design mockups: draws a version through the Budget Gate on the project's
// approved cap and records it in the event log. No generated code runs on this machine, so
// only a vendor key is needed, not the unsandboxed-builds switch.

/** Most one mockup call may cost; it escalates to an approval above this. */
export const MOCKUP_CEILING = usd(0.25);

/** Every recorded mockup version of a project, oldest first. */
export function rendersOf(events: ActivityEvent[]): DesignRender[] {
  return events
    .filter((e) => e.type === 'design_render')
    .map((e) => e.payload as unknown as DesignRender)
    .sort((a, b) => a.version - b.version);
}

const drawing = new Set<string>();

export type MockupOutcome = { ok: true; render: DesignRender } | { ok: false; error: string };

/** `base` is the version the owner was looking at when asking for the change; latest by default. */
export async function requestMockup(project: Project, feedback: string | null, base?: number): Promise<MockupOutcome> {
  const model = designModel(process.env);
  if (!model) {
    return { ok: false, error: 'No model key is set on this server. Add DASHSCOPE_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY to .env.local.' };
  }
  if (drawing.has(project.id)) return { ok: false, error: 'A mockup is already being drawn for this project.' };

  const scope = await userScope();
  const gate = gateFor(scope);
  const budget = await gate.getBudget(project.id).catch(() => null);
  if (!budget) return { ok: false, error: 'Approve the plan and set a cap first: a mockup is paid from it.' };

  const events = new PgEventLog(db(), scope);
  const previous = rendersOf(await events.list(project.id));
  const latest = previous.at(-1);
  const from = previous.find((r) => r.version === base) ?? latest;
  const note = feedback?.trim().slice(0, MAX_FEEDBACK_CHARS) || null;
  if (from && !note) return { ok: false, error: 'Say what to change, so the next version is different.' };

  const price = registry.get(model);
  const adapter = new ClaudeAdapter(gate, registry, transportFor(price.provider), price.provider);
  drawing.add(project.id);
  try {
    const render = await drawMockup({
      caller: adapter,
      projectId: project.id,
      spec: project.spec,
      model,
      version: (latest?.version ?? 0) + 1,
      nonce: randomUUID().slice(0, 8),
      ...(from && note ? { revision: { feedback: from === latest ? note : `${note} (starting from version ${from.version})`, previousHtml: from.html } } : {}),
      taskCeiling: MOCKUP_CEILING,
      costOf: (msg) => priceMessage(msg, price, registry, price.provider).cost,
    });
    await events.append({ projectId: project.id, taskId: DESIGN_TASK, type: 'design_render', payload: { ...render } });
    return { ok: true, render };
  } catch (err) {
    if (err instanceof BudgetBlockedError) {
      return { ok: false, error: 'This mockup could cross your cap, so it is waiting for your approval on the project page.' };
    }
    return { ok: false, error: `The mockup could not be drawn: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}` };
  } finally {
    drawing.delete(project.id);
  }
}
