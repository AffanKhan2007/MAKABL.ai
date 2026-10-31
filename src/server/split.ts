import Anthropic from '@anthropic-ai/sdk';
import { ClaudeAdapter, sdkTransport, type ClaudeTransport } from '../adapters/claude.ts';
import { fetchPost, geminiTransport } from '../adapters/gemini.ts';
import { PgEventLog } from '../db/pg-event-log.ts';
import { usd } from '../domain/types.ts';
import { textOf } from '../relay/relay.ts';
import { parseSplit, ruleSplit, SPLIT_SYSTEM, splitPrompt } from '../spec/split.ts';
import { gateFor } from './builds.ts';
import { db } from './db.ts';
import { registry } from './plan.ts';
import type { SpecFeature } from './projects.ts';
import { userScope } from './session.ts';

// Turns a project's one-line prompt into features with a model, through the Budget Gate
// like every other paid call. The project gets a small planning cap for this one call;
// approving the plan later replaces it with the user's caps. With no key, or if the call
// fails, the keyword split is used and the feed says so.

const PLANNING_CAP = usd(0.05);
const SPLIT_TASK = 'plan:split';

/** The cheapest model with a key on this server, and its transport. */
function splitModel(env: Readonly<Record<string, string | undefined>> = process.env):
  { model: string; provider: string; transport: () => ClaudeTransport } | null {
  if (env.GEMINI_API_KEY) {
    return { model: 'google/gemini-3.5-flash-lite', provider: 'google', transport: () => geminiTransport(fetchPost(env.GEMINI_API_KEY!)) };
  }
  if (env.ANTHROPIC_API_KEY) {
    return { model: 'anthropic/claude-haiku-5-5', provider: 'anthropic', transport: () => sdkTransport(new Anthropic()) };
  }
  return null;
}

export interface SplitResult {
  features: SpecFeature[];
  source: 'ai' | 'rules';
  model: string | null;
  /** Why the keyword split was used, in words safe to show. */
  note: string | null;
}

/** The keyword split, for creating the project before the model call. */
export const draftFeatures = (idea: string): SpecFeature[] => ruleSplit(idea);

/** Ask a model to split the project's prompt; never throws. Records the outcome in the feed. */
export async function splitWithModel(projectId: string, idea: string): Promise<SplitResult> {
  const scope = await userScope();
  const events = new PgEventLog(db(), scope);
  const chosen = splitModel();
  let result: SplitResult;
  if (!chosen) {
    result = { features: ruleSplit(idea), source: 'rules', model: null, note: 'no model key on this server' };
  } else {
    try {
      const gate = gateFor(scope);
      await gate.setBudget(projectId, { projectCap: PLANNING_CAP, monthlyCap: PLANNING_CAP });
      const adapter = new ClaudeAdapter(gate, registry, chosen.transport(), chosen.provider);
      const msg = await adapter.call({
        projectId, taskId: SPLIT_TASK, taskCeiling: PLANNING_CAP, idempotencyKey: SPLIT_TASK,
        description: 'Split the prompt into features', model: chosen.model,
        system: SPLIT_SYSTEM, messages: [{ role: 'user', content: splitPrompt(idea) }], maxTokens: 1_500,
      });
      const features = parseSplit(textOf(msg));
      result = features
        ? { features, source: 'ai', model: chosen.model, note: null }
        : { features: ruleSplit(idea), source: 'rules', model: chosen.model, note: 'the model reply could not be read' };
    } catch (err) {
      const why = (err instanceof Error ? err.message : String(err)).slice(0, 200);
      result = { features: ruleSplit(idea), source: 'rules', model: chosen.model, note: `the model call failed: ${why}` };
    }
  }
  await events.append({
    projectId, taskId: null, type: 'prompt_split',
    payload: {
      source: result.source, model: result.model, note: result.note,
      features: result.features.map((f) => `${f.name} (${f.type})`),
    },
  });
  return result;
}
