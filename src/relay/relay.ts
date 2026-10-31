import type { ClaudeAdapter, ClaudeCall, ClaudeMessage, ModelCaller } from '../adapters/claude.ts';
import { priceMessage } from '../adapters/claude.ts';
import { TEMPLATE_GUIDE } from '../build/template.ts';
import type { Micros } from '../domain/types.ts';
import { BudgetBlockedError, NotChargedError } from '../gate/budget-gate.ts';
import type { Phase } from '../estimator/estimator.ts';
import { worstCaseLlmCost } from '../gate/llm-cost.ts';
import type { PricingRegistry } from '../registry/pricing.ts';
import type { Decision, Negotiator } from './negotiator.ts';

// The relay (#17): spec → architect → build → review, each on its own model. A finishing
// phase writes a short brief and the next phase starts from that brief instead of the
// whole transcript. Every call still goes through a provider adapter and so through the
// Budget Gate; before each call the phase asks the negotiator for room.

export const RELAY_TASK = { spec: 'relay:spec', architect: 'relay:architect' } as const;
export const reviewTaskId = (featureTaskId: string) => `review:${featureTaskId}`;

/** Which relay phase a Gate task belongs to. Feature tasks are the build phase. */
export function phaseOfTask(taskId: string): Phase {
  if (taskId === RELAY_TASK.spec) return 'spec';
  if (taskId === RELAY_TASK.architect) return 'architect';
  if (taskId.startsWith('review:')) return 'review';
  return 'build';
}

const usd = (m: Micros) => `$${(m / 1_000_000).toFixed(4)}`;

/** Text blocks of a response, joined. */
export function textOf(msg: ClaudeMessage): string {
  return msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
}

/** Every token the call read or wrote. */
export function tokensOf(msg: ClaudeMessage): { input: number; output: number } {
  const u = msg.usage;
  return {
    input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    output: u.output_tokens ?? 0,
  };
}

/** Rough token count of text we send, for showing what a brief carries. */
export const approxTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * Calls a model on behalf of a relay phase: picks the adapter for the model's vendor, asks
 * the negotiator for the call's worst case, then books what the call cost.
 */
export class RelayCaller implements ModelCaller {
  private readonly adapters: Partial<Record<string, ClaudeAdapter>>;
  private readonly registry: PricingRegistry;
  private readonly negotiator: Negotiator;
  private readonly onDecision: (d: Decision) => Promise<void>;

  constructor(opts: {
    adapters: Partial<Record<string, ClaudeAdapter>>;
    registry: PricingRegistry;
    negotiator: Negotiator;
    onDecision: (d: Decision) => Promise<void>;
  }) {
    this.adapters = opts.adapters;
    this.registry = opts.registry;
    this.negotiator = opts.negotiator;
    this.onDecision = opts.onDecision;
  }

  async call(c: ClaudeCall): Promise<ClaudeMessage> {
    const price = this.registry.get(c.model);
    const adapter = this.adapters[price.provider];
    if (!adapter) throw new Error(`no live adapter for ${price.provider}`);
    const phase = phaseOfTask(c.taskId);

    // The adapter counts the prompt exactly when it reserves; this estimate is only for the
    // negotiation, and errs high (3 characters per token).
    const promptTokens = Math.ceil(JSON.stringify([c.system ?? '', c.messages, c.tools ?? []]).length / 3);
    const worstCase = worstCaseLlmCost(price, promptTokens, c.maxTokens, c.cache ?? '5m');
    const snap = this.negotiator.phases.get(phase);
    const left = snap ? snap.allowance - snap.spent : 0;
    const decision = this.negotiator.request(
      phase, worstCase,
      `${c.description} could cost up to ${usd(worstCase)}; the ${phase} phase has ${usd(Math.max(0, left))} left`,
    );
    if (decision) await this.onDecision(decision);

    let msg: ClaudeMessage;
    try {
      msg = await adapter.call(c);
    } catch (err) {
      // The Gate books a failed call at its worst case unless the provider refused it
      // outright; the phase carries the same so its spend matches the ledger.
      if (!(err instanceof NotChargedError) && !(err instanceof BudgetBlockedError)) this.negotiator.spend(phase, worstCase);
      throw err;
    }
    this.negotiator.spend(phase, priceMessage(msg, price, this.registry, price.provider).cost);
    return msg;
  }
}

// ---- prompts ---------------------------------------------------------------------------

export const SPEC_SYSTEM = [
  'You are the spec phase of a relay of AI models that builds a small web app.',
  'Read the owner\'s description and feature list and write a brief for the architect, the next model.',
  'The architect will see only your brief, not this conversation, so include everything it needs.',
  'Use exactly these markdown sections: ## Goal, ## Users, ## Features (one line each, with what "done" means),',
  '## Decisions (assumptions you made), ## Open questions.',
  'Keep it under 350 words. No code.',
].join('\n');

export const ARCHITECT_SYSTEM = [
  'You are the architect phase of a relay of AI models that builds a small web app.',
  'You receive the spec brief written by the previous model. Write a technical brief for the builders,',
  'who build one feature each and will see only your brief and their own feature.',
  'Use exactly these markdown sections: ## Files (path: purpose), ## Data (tables or types),',
  '## Conventions (naming, where logic lives, how tests are written), ## Per feature (one line each:',
  'files it touches), ## Risks.',
  'Keep it under 450 words. Plan only what the features need.',
  '',
  'The project the builders start from:',
  TEMPLATE_GUIDE,
].join('\n');

export const REVIEW_SYSTEM = [
  'You are the review phase of a relay of AI models. One feature has just passed its automated checks.',
  'Read its acceptance criteria, check results and code, and say whether it does what the criteria ask.',
  'First line exactly "VERDICT: APPROVE" or "VERDICT: CONCERNS". Then at most 5 short bullet points.',
  'Only raise concerns a reader could verify in the code shown.',
].join('\n');

export function specPrompt(idea: string, features: Array<{ name: string; type: string; acceptance: string[] }>): string {
  return [
    `Description: ${idea}`,
    '',
    'Features:',
    ...features.map((f) => `- ${f.name} (${f.type}): ${f.acceptance.join('; ')}`),
  ].join('\n');
}

export function architectPrompt(specBrief: string): string {
  return `Spec brief from the previous model:\n\n${specBrief}`;
}

export function reviewPrompt(opts: {
  feature: string;
  acceptance: string[];
  checks: Array<{ name: string; passed: boolean }>;
  files: Array<{ path: string; content: string }>;
}): string {
  return [
    `Feature: ${opts.feature}`,
    '',
    'Acceptance criteria:',
    ...opts.acceptance.map((a) => `- ${a}`),
    '',
    'Automated checks:',
    ...opts.checks.map((c) => `- ${c.name}: ${c.passed ? 'passed' : 'failed'}`),
    '',
    'Code written for this feature:',
    ...opts.files.map((f) => `--- ${f.path}\n${f.content}`),
  ].join('\n');
}

/** The verdict line of a review, or null if the model did not follow the format. */
export function verdictOf(review: string): 'approve' | 'concerns' | null {
  const m = /VERDICT:\s*(APPROVE|CONCERNS)/i.exec(review);
  return m ? (m[1]!.toLowerCase() as 'approve' | 'concerns') : null;
}

/** One call for a single-pass phase (spec, architect, review). */
export function phaseCall(opts: {
  projectId: string; taskId: string; idempotencyKey: string; description: string; model: string;
  system: string; prompt: string; maxTokens: number; taskCeiling: Micros;
}): ClaudeCall {
  return {
    projectId: opts.projectId,
    taskId: opts.taskId,
    taskCeiling: opts.taskCeiling,
    idempotencyKey: opts.idempotencyKey,
    description: opts.description,
    model: opts.model,
    system: opts.system,
    messages: [{ role: 'user', content: opts.prompt }],
    maxTokens: opts.maxTokens,
    effort: 'low',
  };
}
