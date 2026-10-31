import { usd } from '../domain/types.ts';
import type { PriceEntry, TokenRates } from './pricing.ts';

// Every text model a relay phase can run on, from the three vendors' official pricing pages,
// all checked 2026-10-31. One row per model: its catalog details and its standard-tier price
// per 1M tokens. Left out on purpose: retired models, Claude Mythos (limited access),
// specialised models (search, cyber, life sciences, live audio, robotics), dated snapshots,
// and gpt-3.5-turbo / gpt-4-0613, whose 16K / 8K context windows are smaller than one build
// loop needs.

export type Vendor = 'Anthropic' | 'OpenAI' | 'Google' | 'Groq' | 'OpenRouter' | 'Mistral';

export interface ModelInfo {
  id: string;
  label: string;
  vendor: Vendor;
  /** preview: may change or be withdrawn; legacy: an older generation, still sold. */
  lifecycle?: 'preview' | 'legacy' | 'deprecated';
}

const VERIFIED = '2026-10-31';
const REVALIDATE = '2027-01-31';
const SOURCES: Record<Vendor, string> = {
  Anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
  OpenAI: 'https://developers.openai.com/api/docs/pricing',
  Google: 'https://ai.google.dev/gemini-api/docs/pricing',
  Groq: 'https://groq.com/pricing',
  OpenRouter: 'https://openrouter.ai/models?max_price=0',
  Mistral: 'https://mistral.ai/pricing#api-pricing',
};
const PROVIDER: Record<Vendor, string> = {
  Anthropic: 'anthropic', OpenAI: 'openai', Google: 'google', Groq: 'groq', OpenRouter: 'openrouter', Mistral: 'mistral',
};

interface Row extends Omit<ModelInfo, 'id'> {
  product: string;
  /** input, output, cache read; cache writes: [5m, 1h] for Claude, plain input elsewhere. */
  rates: [number, number, number | null];
  writes?: [number, number];
  extra?: Partial<PriceEntry>;
}

/** Rates in dollars per 1M tokens, as micros. A model without cached input reads at full price. */
function tokenRates(r: Row['rates'], writes?: [number, number]): TokenRates {
  const [input, output, read] = r;
  return {
    inputPerMTok: usd(input), outputPerMTok: usd(output),
    // OpenAI caches automatically and Gemini's implicit caching bills reads only, so a
    // cache write costs what plain input costs there.
    cacheWrite5mPerMTok: usd(writes ? writes[0] : input),
    cacheWrite1hPerMTok: usd(writes ? writes[1] : input),
    cacheReadPerMTok: usd(read ?? input),
  };
}

const longTier = (overTokens: number, r: Row['rates']) => ({ overTokens, rates: tokenRates(r) });
const doubles = (from: string, note: string, r: Row['rates']) => ({ priceChanges: [{ from, note, rates: tokenRates(r) }] });
const FREE_TIER = { freeTier: { note: 'Free tier available; its rate limits are not on the pricing page' } };
const UNVERIFIED_FREE = {
  confidence: 'unverified' as const,
  freeTier: { note: 'Free tier with a daily request limit; paid rate not yet checked' },
};
// OpenAI flagship models list separate prices above 272K input tokens.
const openaiLong = (r: Row['rates']) => ({ longPrompt: longTier(272_000, r) });

const ROWS: Row[] = [
  // Anthropic. Cache writes: 1.25x input for 5 minutes, 2x for 1 hour.
  { vendor: 'Anthropic', label: 'Claude Fable 5.1', product: 'claude-fable-5-1', rates: [10, 50, 0.25], writes: [12.5, 20] },
  { vendor: 'Anthropic', label: 'Claude Fable 5', product: 'claude-fable-5', rates: [10, 50, 1], writes: [12.5, 20] },
  { vendor: 'Anthropic', label: 'Claude Opus 5.5', product: 'claude-opus-5-5', rates: [4, 20, 0.2], writes: [5, 8] },
  { vendor: 'Anthropic', label: 'Claude Opus 5', product: 'claude-opus-5', rates: [5, 25, 0.5], writes: [6.25, 10] },
  { vendor: 'Anthropic', label: 'Claude Opus 4.8', product: 'claude-opus-4-8', rates: [5, 25, 0.5], writes: [6.25, 10], lifecycle: 'legacy' },
  { vendor: 'Anthropic', label: 'Claude Opus 4.7', product: 'claude-opus-4-7', rates: [5, 25, 0.5], writes: [6.25, 10], lifecycle: 'legacy' },
  { vendor: 'Anthropic', label: 'Claude Opus 4.6', product: 'claude-opus-4-6', rates: [5, 25, 0.5], writes: [6.25, 10], lifecycle: 'legacy' },
  { vendor: 'Anthropic', label: 'Claude Opus 4.5', product: 'claude-opus-4-5', rates: [5, 25, 0.5], writes: [6.25, 10], lifecycle: 'legacy' },
  { vendor: 'Anthropic', label: 'Claude Sonnet 5.5', product: 'claude-sonnet-5-5', rates: [2, 10, 0.1], writes: [2.5, 4] },
  { vendor: 'Anthropic', label: 'Claude Sonnet 5', product: 'claude-sonnet-5', rates: [2, 10, 0.2], writes: [2.5, 4] },
  { vendor: 'Anthropic', label: 'Claude Sonnet 4.6', product: 'claude-sonnet-4-6', rates: [3, 15, 0.3], writes: [3.75, 6], lifecycle: 'legacy' },
  { vendor: 'Anthropic', label: 'Claude Sonnet 4.5', product: 'claude-sonnet-4-5', rates: [3, 15, 0.3], writes: [3.75, 6], lifecycle: 'deprecated' },
  {
    vendor: 'Anthropic', label: 'Claude Haiku 5.5', product: 'claude-haiku-5-5', rates: [0.1, 0.5, 0.01], writes: [0.125, 0.2],
    // A request whose prompt (cache reads and writes included) is over 100K pays these for all of it.
    extra: { longPrompt: { overTokens: 100_000, rates: tokenRates([0.5, 2.5, 0.05], [0.625, 1]) } },
  },
  { vendor: 'Anthropic', label: 'Claude Haiku 4.5', product: 'claude-haiku-4-5', rates: [1, 5, 0.1], writes: [1.25, 2], lifecycle: 'legacy' },

  // OpenAI
  { vendor: 'OpenAI', label: 'GPT-6 Astra', product: 'gpt-6-astra', rates: [10, 50, 1], extra: openaiLong([20, 75, 2]) },
  { vendor: 'OpenAI', label: 'GPT-6.1 Sol', product: 'gpt-6.1-sol', rates: [2, 10, 0.1], extra: openaiLong([4, 15, 0.2]) },
  { vendor: 'OpenAI', label: 'GPT-6.1 Terra', product: 'gpt-6.1-terra', rates: [1, 5, 0.05], extra: openaiLong([2, 7.5, 0.1]) },
  { vendor: 'OpenAI', label: 'GPT-6 Luna', product: 'gpt-6-luna', rates: [0.1, 0.5, 0.01], extra: openaiLong([0.2, 0.75, 0.02]) },
  { vendor: 'OpenAI', label: 'GPT-6 Sol', product: 'gpt-6-sol', rates: [2, 10, 0.2], extra: openaiLong([4, 15, 0.4]), lifecycle: 'legacy' },
  {
    vendor: 'OpenAI', label: 'GPT-5.6 Sol', product: 'gpt-5.6-sol', rates: [4, 20, 0.4], lifecycle: 'legacy',
    extra: { ...openaiLong([8, 30, 0.8]), promotionalUntil: '2026-11-21' },
  },
  { vendor: 'OpenAI', label: 'GPT-5.6 Terra', product: 'gpt-5.6-terra', rates: [2, 12, 0.2], extra: openaiLong([4, 18, 0.4]), lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'GPT-5.6 Luna', product: 'gpt-5.6-luna', rates: [0.2, 1.2, 0.02], extra: openaiLong([0.4, 1.8, 0.04]), lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'GPT-5.5', product: 'gpt-5.5', rates: [5, 30, 0.5], extra: openaiLong([10, 45, 1]), lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'GPT-5.5 Pro', product: 'gpt-5.5-pro', rates: [30, 180, null], extra: openaiLong([60, 270, null]), lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'GPT-5.4', product: 'gpt-5.4', rates: [2.5, 15, 0.25], extra: openaiLong([5, 22.5, 0.5]), lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'GPT-5.4 Pro', product: 'gpt-5.4-pro', rates: [30, 180, null], extra: openaiLong([60, 270, null]), lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'GPT-5.4 mini', product: 'gpt-5.4-mini', rates: [0.75, 4.5, 0.075], lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'GPT-5.4 nano', product: 'gpt-5.4-nano', rates: [0.2, 1.25, 0.02], lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'GPT-5.3 Codex', product: 'gpt-5.3-codex', rates: [1.75, 14, 0.175], lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'GPT-5.2', product: 'gpt-5.2', rates: [1.75, 14, 0.175], lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'GPT-5.2 Pro', product: 'gpt-5.2-pro', rates: [21, 168, null], lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'GPT-5.1', product: 'gpt-5.1', rates: [1.25, 10, 0.125], lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'GPT-5', product: 'gpt-5', rates: [1.25, 10, 0.125], lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'GPT-5 mini', product: 'gpt-5-mini', rates: [0.25, 2, 0.025], lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'GPT-5 nano', product: 'gpt-5-nano', rates: [0.05, 0.4, 0.005], lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'GPT-5 Pro', product: 'gpt-5-pro', rates: [15, 120, null], lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'GPT-4.1', product: 'gpt-4.1', rates: [2, 8, 0.5], lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'GPT-4.1 mini', product: 'gpt-4.1-mini', rates: [0.4, 1.6, 0.1], lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'GPT-4.1 nano', product: 'gpt-4.1-nano', rates: [0.1, 0.4, 0.025], lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'GPT-4o', product: 'gpt-4o', rates: [2.5, 10, 1.25], lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'GPT-4o mini', product: 'gpt-4o-mini', rates: [0.15, 0.6, 0.075], lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'o3', product: 'o3', rates: [2, 8, 0.5], lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'o3 Pro', product: 'o3-pro', rates: [20, 80, null], lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'o4-mini', product: 'o4-mini', rates: [1.1, 4.4, 0.275], lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'o3-mini', product: 'o3-mini', rates: [1.1, 4.4, 0.55], lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'o1', product: 'o1', rates: [15, 60, 7.5], lifecycle: 'legacy' },
  { vendor: 'OpenAI', label: 'o1 Pro', product: 'o1-pro', rates: [150, 600, null], lifecycle: 'legacy' },

  // Google (paid tier, text input)
  {
    vendor: 'Google', label: 'Gemini 4 Argon', product: 'gemini-4-argon', rates: [2, 10, 0.1],
    extra: doubles('2026-12-01', 'Gemini 4 Argon doubles on 1 Dec 2026', [4, 20, 0.2]),
  },
  {
    vendor: 'Google', label: 'Gemini 3.8 Flash', product: 'gemini-3.8-flash', rates: [0.75, 3.75, 0.075],
    extra: { ...doubles('2027-01-01', 'Gemini 3.8 Flash doubles on 1 Jan 2027', [1.5, 7.5, 0.15]), ...FREE_TIER },
  },
  {
    vendor: 'Google', label: 'Gemini 3.6 Flash', product: 'gemini-3.6-flash', rates: [0.75, 3.75, 0.075],
    extra: { ...doubles('2027-01-01', 'Gemini 3.6 Flash doubles on 1 Jan 2027', [1.5, 7.5, 0.15]), ...FREE_TIER },
  },
  { vendor: 'Google', label: 'Gemini 3.5 Flash-Lite', product: 'gemini-3.5-flash-lite', rates: [0.3, 2.5, 0.03], extra: FREE_TIER },
  { vendor: 'Google', label: 'Gemini 3.1 Flash-Lite', product: 'gemini-3.1-flash-lite', rates: [0.25, 1.5, 0.025], extra: FREE_TIER },
  {
    vendor: 'Google', label: 'Gemini 3.1 Pro Preview', product: 'gemini-3.1-pro-preview', rates: [2, 12, 0.2], lifecycle: 'preview',
    extra: { longPrompt: longTier(200_000, [4, 18, 0.4]) },
  },
  { vendor: 'Google', label: 'Gemini 3 Flash Preview', product: 'gemini-3-flash-preview', rates: [0.5, 3, 0.05], lifecycle: 'preview', extra: FREE_TIER },
  {
    vendor: 'Google', label: 'Gemini 2.5 Pro', product: 'gemini-2.5-pro', rates: [1.25, 10, 0.125], lifecycle: 'legacy',
    extra: { longPrompt: longTier(200_000, [2.5, 15, 0.25]), ...FREE_TIER },
  },
  { vendor: 'Google', label: 'Gemini 2.5 Flash', product: 'gemini-2.5-flash', rates: [0.3, 2.5, 0.03], lifecycle: 'legacy', extra: FREE_TIER },
  { vendor: 'Google', label: 'Gemini 2.5 Flash-Lite', product: 'gemini-2.5-flash-lite', rates: [0.1, 0.4, 0.01], lifecycle: 'legacy', extra: FREE_TIER },

  // Free-tier providers added for the hackathon (OpenAI-compatible APIs). Paid rates are not
  // yet checked against the pricing pages, so they are marked unverified and show as
  // assumptions; on the free tiers the calls cost nothing.
  { vendor: 'Groq', label: 'GPT-OSS 120B (Groq)', product: 'gpt-oss-120b', rates: [0, 0, null], extra: UNVERIFIED_FREE },
  { vendor: 'OpenRouter', label: 'Nemotron 550B (OpenRouter, free)', product: 'nemotron-ultra-free', rates: [0, 0, null], extra: UNVERIFIED_FREE },
  { vendor: 'OpenRouter', label: 'Gemma 4 31B (OpenRouter, free)', product: 'gemma-4-31b-free', rates: [0, 0, null], extra: UNVERIFIED_FREE },
  { vendor: 'Mistral', label: 'Mistral Small', product: 'mistral-small-latest', rates: [0.1, 0.3, null], extra: UNVERIFIED_FREE },
  { vendor: 'Mistral', label: 'Devstral Small', product: 'devstral-small-latest', rates: [0.1, 0.3, null], extra: UNVERIFIED_FREE },
];

const idOf = (r: Row) => `${PROVIDER[r.vendor]}/${r.product}`;

export const MODEL_CATALOG: ModelInfo[] = ROWS.map((r) => ({
  id: idOf(r), label: r.label, vendor: r.vendor, ...(r.lifecycle ? { lifecycle: r.lifecycle } : {}),
}));

export const modelPrices: PriceEntry[] = ROWS.map((r) => ({
  id: idOf(r), provider: PROVIDER[r.vendor], product: r.product, plan: 'api', category: 'llm',
  currency: 'USD', unit: 'token', rates: tokenRates(r.rates, r.writes),
  billingPeriod: 'usage', commercialUse: 'allowed', sourceUrl: SOURCES[r.vendor],
  verifiedAt: VERIFIED, confidence: 'high', revalidateAfter: REVALIDATE,
  ...(r.lifecycle ? { lifecycle: r.lifecycle } : {}),
  ...r.extra,
}));
