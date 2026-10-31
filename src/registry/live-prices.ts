import type { Micros } from '../domain/types.ts';
import { ratesOn, type PriceEntry, type PricingRegistry } from './pricing.ts';

// Live prices. The registry's prices are typed in from each vendor's page and go stale. This
// fetches OpenRouter's public model list (current per-token prices, no key needed) and
// compares it with the registry, so the plan can say, with a timestamp, whether the prices it
// uses still match a live source and where they do not. The registry stays the basis for
// billing (we call vendors directly); the live list is the independent check.

export const LIVE_PRICE_URL = 'https://openrouter.ai/api/v1/models';

export interface LivePrice {
  /** OpenRouter's id for the model. */
  source: string;
  /** Micros of a dollar per 1M tokens. */
  inputPerMTok: Micros;
  outputPerMTok: Micros;
  cacheReadPerMTok: Micros | null;
}

export interface LivePrices {
  fetchedAt: string;
  byRegistryId: Map<string, LivePrice>;
  /** How many registry models were found on the live list, of how many were looked up. */
  found: number;
  asked: number;
}

/** OpenRouter writes Claude versions with dots (claude-opus-5.5); the registry uses hyphens. */
export function openRouterId(price: Pick<PriceEntry, 'provider' | 'product'>): string {
  const product = price.provider === 'anthropic' ? price.product.replace(/(\d)-(\d)/g, '$1.$2') : price.product;
  return `${price.provider}/${product}`;
}

interface RawModel { id: string; pricing?: { prompt?: string; completion?: string; input_cache_read?: string } }

const perMTok = (perToken: string | undefined): Micros | null => {
  const n = Number(perToken);
  return Number.isFinite(n) && n >= 0 && perToken !== undefined ? Math.round(n * 1e12) : null;
};

/** Parse the live list for every LLM in the registry. Exact id matches only. */
export function parseLivePrices(raw: unknown, registry: PricingRegistry, now: Date): LivePrices {
  const list = (raw as { data?: RawModel[] } | null)?.data ?? [];
  const byId = new Map(list.map((m) => [m.id, m]));
  const byRegistryId = new Map<string, LivePrice>();
  const llms = registry.llms();
  for (const p of llms) {
    const m = byId.get(openRouterId(p));
    const input = perMTok(m?.pricing?.prompt);
    const output = perMTok(m?.pricing?.completion);
    if (m && input !== null && output !== null) {
      byRegistryId.set(p.id, { source: m.id, inputPerMTok: input, outputPerMTok: output, cacheReadPerMTok: perMTok(m.pricing?.input_cache_read) });
    }
  }
  return { fetchedAt: now.toISOString(), byRegistryId, found: byRegistryId.size, asked: llms.length };
}

export interface PriceDrift {
  id: string;
  /** Relative difference of the live price from the registry's, per side. */
  input: number;
  output: number;
  live: LivePrice;
  registry: { inputPerMTok: Micros; outputPerMTok: Micros };
}

/** Models whose live price differs from the registry's by more than `tolerance` (default 2%). */
export function priceDrift(live: LivePrices, registry: PricingRegistry, today: string, tolerance = 0.02): PriceDrift[] {
  const out: PriceDrift[] = [];
  for (const [id, lp] of live.byRegistryId) {
    const r = ratesOn(registry.get(id), today);
    if (r.inputPerMTok === undefined || r.outputPerMTok === undefined) continue;
    const input = r.inputPerMTok ? lp.inputPerMTok / r.inputPerMTok - 1 : 0;
    const output = r.outputPerMTok ? lp.outputPerMTok / r.outputPerMTok - 1 : 0;
    if (Math.abs(input) > tolerance || Math.abs(output) > tolerance) {
      out.push({ id, input, output, live: lp, registry: { inputPerMTok: r.inputPerMTok, outputPerMTok: r.outputPerMTok } });
    }
  }
  return out;
}

const g = globalThis as typeof globalThis & { __makablLive?: { at: number; value: LivePrices | null; inflight?: Promise<LivePrices | null> } };
const TTL_MS = 10 * 60_000;

/** The live list, cached for ten minutes; null when it cannot be reached (never throws). */
export async function fetchLivePrices(
  registry: PricingRegistry, fetchImpl: typeof fetch = fetch, now: () => Date = () => new Date(),
): Promise<LivePrices | null> {
  const cache = (g.__makablLive ??= { at: 0, value: null });
  if (cache.value && Date.now() - cache.at < TTL_MS) return cache.value;
  if (cache.inflight) return cache.inflight;
  cache.inflight = (async () => {
    try {
      const res = await fetchImpl(LIVE_PRICE_URL, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return cache.value;
      const value = parseLivePrices(await res.json(), registry, now());
      cache.value = value;
      cache.at = Date.now();
      return value;
    } catch {
      return cache.value; // an older answer is better than none, and it carries its own timestamp
    } finally {
      cache.inflight = undefined;
    }
  })();
  return cache.inflight;
}
