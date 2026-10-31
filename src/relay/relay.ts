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
  private readonly onDecision: (d: Decision, before: ReturnType<Negotiator['snapshot']>) => Promise<void>;
  private readonly used = new Map<Phase, { input: number; output: number; calls: number }>();
  /** What each Gate task has spent here, to work out how much of its phase's allowance is left for it. */
  private readonly taskSpent = new Map<string, number>();

  constructor(opts: {
    adapters: Partial<Record<string, ClaudeAdapter>>;
    registry: PricingRegistry;
    negotiator: Negotiator;
    onDecision: (d: Decision, before: ReturnType<Negotiator['snapshot']>) => Promise<void>;
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
    const before = this.negotiator.snapshot();
    const decision = this.negotiator.request(
      phase, worstCase,
      `${c.description} could cost up to ${usd(worstCase)}; the ${phase} phase has ${usd(Math.max(0, left))} left`,
    );
    if (decision) await this.onDecision(decision, before);

    // Enforcement: the Gate's ceiling for this task is what the phase may still spend on it
    // (its allowance, less what the phase's other tasks have used). If the negotiator could not
    // find room, the allowance is unchanged and the Gate blocks the call and asks the user.
    const after = this.negotiator.phases.get(phase);
    const taskSpent = this.taskSpent.get(c.taskId) ?? 0;
    const ceiling = after ? Math.max(0, after.allowance - (after.spent - taskSpent)) : c.taskCeiling;

    let msg: ClaudeMessage;
    try {
      msg = await adapter.call({ ...c, taskCeiling: Math.min(c.taskCeiling, ceiling) });
    } catch (err) {
      // The Gate books a failed call at its worst case unless the provider refused it
      // outright; the phase carries the same so its spend matches the ledger.
      if (!(err instanceof NotChargedError) && !(err instanceof BudgetBlockedError)) {
        this.negotiator.spend(phase, worstCase);
        this.taskSpent.set(c.taskId, taskSpent + worstCase);
      }
      throw err;
    }
    const cost = priceMessage(msg, price, this.registry, price.provider).cost;
    this.negotiator.spend(phase, cost);
    this.taskSpent.set(c.taskId, taskSpent + cost);
    const t = tokensOf(msg);
    const u = this.used.get(phase) ?? { input: 0, output: 0, calls: 0 };
    this.used.set(phase, { input: u.input + t.input, output: u.output + t.output, calls: u.calls + 1 });
    return msg;
  }

  /** Tokens read and written so far by a phase, across every call it made. */
  usage(phase: Phase): { input: number; output: number; calls: number } {
    return this.used.get(phase) ?? { input: 0, output: 0, calls: 0 };
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
  'Use exactly these markdown sections: ## Wireframe (for each page, a small text sketch of its layout',
  'in a code block of at most 12 lines, then one line naming its main parts), ## Data (tables or types),',
  '## Files (path: purpose), ## Conventions (naming, where logic lives, how tests are written),',
  '## Per feature (one line each: files it touches), ## Risks.',
  'The builders follow the wireframe, so draw only what the spec asks for: no pages, sign-in or',
  'features the spec does not mention.',
  'Keep it under 600 words. Plan only what the features need.',
  '',
  'The project the builders start from:',
  TEMPLATE_GUIDE,
].join('\n');

export const REVIEW_SYSTEM = [
  'You are the review phase of a relay of AI models. One feature has just passed its automated checks.',
  'Read its acceptance criteria, check results and code, and say whether it does what the criteria ask.',
  'First line exactly "VERDICT: APPROVE" or "VERDICT: CONCERNS". Then at most 5 short bullet points.',
  'Only raise concerns a reader could verify in the code shown. A file ending with a "[clipped by MAKABL ...]" note was cut by the platform, not by the author: do not call it truncated.',
  'Also check that the feature does only what the criteria and the idea ask: flag extra behaviour nobody requested (for example a login wall) as a concern.',
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
  /** The render the owner chose, if any: the review also checks the build against it. */
  design?: string;
  feature: string;
  acceptance: string[];
  checks: Array<{ name: string; passed: boolean }>;
  files: Array<{ path: string; content: string }>;
}): string {
  return [
    ...(opts.design ? [opts.design, '', 'Also say how closely the code follows that design (layout, palette, typography, spacing) and name the biggest differences.', ''] : []),
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

export const OVERSEER_SYSTEM = [
  'You are the overseer of an app build. Other models write the code; you check that what was built is what the owner asked for.',
  'You are given the plan, the owner\'s own instructions, a mechanical check of the code against the chosen design render, and the code.',
  'Decide whether the feature matches the render (colours, wording, section order, tone), follows the owner\'s instructions and does',
  'what the plan says. Be specific and brief. If everything is right, reply "OK" and one line why.',
  'If not, reply with a line "FIX:" followed by a short numbered list of concrete changes (file, what to change, the exact colour or',
  'wording to use). Never ask for new features, only for what was asked. At most 6 items.',
].join('\n');
