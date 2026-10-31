import Anthropic from '@anthropic-ai/sdk';
import type { RunAccumulator } from '../calibration/runs.ts';
import type { CostBasis, Micros } from '../domain/types.ts';
import type { BudgetGate } from '../gate/budget-gate.ts';
import { observedLlmCost, worstCaseLlmCost, type CacheWrite, type LlmUsage } from '../gate/llm-cost.ts';
import { tokenRatesFor, type PriceEntry, type PricingRegistry } from '../registry/pricing.ts';

// Claude adapter (working model section 9). The only way the platform calls a model:
// every call goes through BudgetGate.execute, so there is no unbudgeted path.
//
// Per call: count the prompt's tokens, reserve the worst case, send, then settle to the
// cost of what the response's usage says was billed.
//
// Refusal fallbacks are on for the models that support "default" fallbacks. A fallback
// is a second attempt billed at the fallback model's rates, so the reservation covers
// both attempts and settling prices each attempt in usage.iterations at its own model.

type MessageParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type CountParams = Anthropic.Beta.Messages.MessageCountTokensParams;
export type ClaudeMessage = Anthropic.Beta.Messages.BetaMessage;

/** The two API operations the adapter needs; tests substitute a fake. */
export interface ClaudeTransport {
  countTokens(params: CountParams): Promise<number>;
  send(params: MessageParams): Promise<ClaudeMessage>;
}

/** The real transport. Streams so long, high-max_tokens calls do not hit HTTP timeouts. */
export function sdkTransport(client: Anthropic = new Anthropic()): ClaudeTransport {
  return {
    countTokens: async (params) => (await client.beta.messages.countTokens(params)).input_tokens,
    send: (params) => client.beta.messages.stream(params).finalMessage(),
  };
}

/** Models that accept fallbacks: "default" (Claude API). Haiku 5.5 has no fallback. */
const DEFAULT_FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** Where "default" sends cyber-category declines; bounds a fallback attempt's rates. */
const FALLBACK_BOUND_ID = 'anthropic/claude-opus-4-8';

export interface ClaudeCall {
  projectId: string;
  taskId: string;
  taskCeiling: Micros;
  /** Stable per logical step, so a resumed step replays instead of paying twice. */
  idempotencyKey: string;
  description: string;
  /** Registry id, e.g. anthropic/claude-opus-5-5. */
  model: string;
  system?: string | Anthropic.Beta.Messages.BetaTextBlockParam[];
  messages: Anthropic.Beta.Messages.BetaMessageParam[];
  tools?: Anthropic.Beta.Messages.BetaToolUnion[];
  maxTokens: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Prompt-cache lifetime for automatic caching; '5m' by default. */
  cache?: CacheWrite;
  /** Collects usage for the calibration run this call belongs to. */
  run?: RunAccumulator;
}

export interface PricedUsage {
  cost: Micros;
  basis: CostBasis;
  /** Per attempt: registry id that billed it, usage, cost. */
  attempts: Array<{ model: string; usage: LlmUsage; cost: Micros }>;
  /** Models in the response the registry could not price; priced at the highest known rates. */
  unknownModels: string[];
}

type UsageEntry = LlmUsage & { model?: string | null };

const hasTokens = (e: unknown): e is UsageEntry =>
  typeof e === 'object' && e !== null
  && typeof (e as UsageEntry).input_tokens === 'number'
  && typeof (e as UsageEntry).output_tokens === 'number';

/**
 * Price a response. usage.iterations is the per-attempt source of truth when present;
 * the top-level usage covers only the attempt that produced the returned message.
 */
export function priceMessage(msg: ClaudeMessage, requested: PriceEntry, registry: PricingRegistry): PricedUsage {
  const iterations: unknown[] = msg.usage.iterations ?? [];
  const entries: UsageEntry[] = iterations.length
    ? iterations.filter(hasTokens)
    : [{ ...(msg.usage as LlmUsage), model: msg.model }];

  const priciest = maxRatePrice(registry, requested.provider);
  const attempts: PricedUsage['attempts'] = [];
  const unknownModels: string[] = [];
  for (const e of entries) {
    const apiModel = e.model ?? requested.product;
    const known = registry.find(`${requested.provider}/${apiModel}`);
    if (!known) unknownModels.push(apiModel);
    const price = known ?? priciest;
    attempts.push({ model: price.id, usage: e, cost: observedLlmCost(price, e) });
  }
  return {
    cost: attempts.reduce((s, a) => s + a.cost, 0),
    basis: unknownModels.length ? 'estimated' : 'usage_observed',
    attempts,
    unknownModels,
  };
}

/** The provider's entry with the highest output rate: a ceiling for an unknown model. */
function maxRatePrice(registry: PricingRegistry, provider: string): PriceEntry {
  const llms = registry.llms().filter((p) => p.provider === provider);
  if (!llms.length) throw new Error('registry has no LLM prices');
  return llms.reduce((a, b) =>
    (tokenRatesFor(b, 0).outputPerMTok > tokenRatesFor(a, 0).outputPerMTok ? b : a));
}

export class ClaudeAdapter {
  private readonly gate: BudgetGate;
  private readonly registry: PricingRegistry;
  private readonly transport: ClaudeTransport;

  constructor(gate: BudgetGate, registry: PricingRegistry, transport: ClaudeTransport) {
    this.gate = gate;
    this.registry = registry;
    this.transport = transport;
  }

  /** Worst case for a request: one attempt, plus a fallback attempt where fallbacks are on. */
  worstCase(price: PriceEntry, promptTokens: number, maxTokens: number, cache: CacheWrite): Micros {
    const primary = worstCaseLlmCost(price, promptTokens, maxTokens, cache);
    if (!DEFAULT_FALLBACK_MODELS.has(price.product)) return primary;
    // Whether a declined attempt is billed depends on when it declined; assume it is.
    return primary + worstCaseLlmCost(this.registry.get(FALLBACK_BOUND_ID), promptTokens, maxTokens, cache);
  }

  async call(c: ClaudeCall): Promise<ClaudeMessage> {
    const price = this.registry.get(c.model);
    if (price.category !== 'llm') throw new Error(`${c.model} is not a model`);
    const cache = c.cache ?? '5m';
    const fallbacks = DEFAULT_FALLBACK_MODELS.has(price.product);

    const params: MessageParams = {
      model: price.product,
      max_tokens: c.maxTokens,
      messages: c.messages,
      ...(c.system === undefined ? {} : { system: c.system }),
      ...(c.tools === undefined ? {} : { tools: c.tools }),
      ...(c.effort === undefined ? {} : { output_config: { effort: c.effort } }),
      ...(cache === 'none' ? {} : { cache_control: { type: 'ephemeral', ttl: cache } }),
      ...(fallbacks ? { fallbacks: 'default', betas: [FALLBACK_BETA] } : {}),
    };

    // The reservation needs the exact prompt size, counted with the same model.
    const promptTokens = await this.transport.countTokens({
      model: params.model,
      messages: params.messages,
      ...(params.system === undefined ? {} : { system: params.system }),
      ...(params.tools === undefined ? {} : { tools: params.tools }),
    });

    const worstCase = this.worstCase(price, promptTokens, c.maxTokens, cache);
    const msg = await this.gate.execute(
      {
        projectId: c.projectId,
        taskId: c.taskId,
        taskCeiling: c.taskCeiling,
        idempotencyKey: c.idempotencyKey,
        worstCase,
        description: c.description,
      },
      async () => {
        let sent: ClaudeMessage;
        try {
          sent = await this.transport.send(params);
        } catch (err) {
          // The Gate books the worst case for a failed call; the run carries the same.
          c.run?.addCharge(price.id, worstCase);
          throw err;
        }
        const priced = priceMessage(sent, price, this.registry);
        return { result: sent, observed: priced.cost, basis: priced.basis };
      },
    );
    // Counted here rather than inside the call so that a step replayed after a pause
    // still counts toward its feature's run. Pricing is deterministic from usage, so
    // this matches what the Gate booked.
    if (c.run) {
      for (const a of priceMessage(msg, price, this.registry).attempts) c.run.add(a.model, a.usage, a.cost);
    }
    return msg;
  }
}
