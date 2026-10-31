import { ProviderLimitError, type ClaudeCall, type ClaudeMessage, type ModelCaller } from '../adapters/claude.ts';
import { withoutGeminiSignatures } from '../adapters/gemini.ts';

// Free-tier quotas are per model, so when one Gemini model's quota is used up the same call
// can go to another Gemini model instead of failing the build. The exhausted model stays
// skipped for the rest of the build, every call is still priced at the model that ran it
// (the inner caller goes through the Budget Gate), and each switch is reported.

/** Gemini models to fall back through, strongest first. */
export const GEMINI_FALLBACKS = [
  'google/gemini-3.8-flash', 'google/gemini-3.6-flash', 'google/gemini-3-flash-preview',
  'google/gemini-3.5-flash-lite', 'google/gemini-3.1-flash-lite',
] as const;

export interface Switch { taskId: string; from: string; to: string; reason: string }

export class FallbackCaller implements ModelCaller {
  private readonly inner: ModelCaller;
  private readonly chain: readonly string[];
  private readonly onSwitch: (s: Switch) => Promise<void>;
  private readonly exhausted = new Set<string>();

  constructor(inner: ModelCaller, onSwitch: (s: Switch) => Promise<void>, chain: readonly string[] = GEMINI_FALLBACKS) {
    this.inner = inner;
    this.onSwitch = onSwitch;
    this.chain = chain;
  }

  /** The model a call planned for `model` runs on now: itself, or the next one with quota. */
  current(model: string): string | null {
    if (!this.exhausted.has(model)) return model;
    if (!this.chain.includes(model)) return null;
    const start = this.chain.indexOf(model);
    const order = [...this.chain.slice(start + 1), ...this.chain.slice(0, start)];
    return order.find((m) => !this.exhausted.has(m)) ?? null;
  }

  async call(c: ClaudeCall): Promise<ClaudeMessage> {
    for (;;) {
      const model = this.current(c.model);
      if (!model) throw new ProviderLimitError(`Every Gemini model's free quota is used up for today; it resets tomorrow.`);
      const switched = model !== c.model;
      try {
        return await this.inner.call(switched
          ? { ...c, model, idempotencyKey: `${c.idempotencyKey}@${model}`, messages: withoutGeminiSignatures(c.messages) }
          : c);
      } catch (err) {
        if (!(err instanceof ProviderLimitError) || !this.chain.includes(model)) throw err;
        this.exhausted.add(model);
        const next = this.current(c.model);
        if (next) await this.onSwitch({ taskId: c.taskId, from: model, to: next, reason: err.message });
      }
    }
  }
}
