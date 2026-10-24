import type { Micros } from '../domain/types.ts';
import type { PriceEntry } from '../registry/pricing.ts';

/** Usage fields as returned on a Messages API response. */
export interface LlmUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/**
 * Worst case for one model call (7.4 step 1): the whole prompt plus max_tokens of output.
 * Cache writes can cost more than plain input, so callers using prompt caching should
 * pass a cache-write multiplier.
 */
export function worstCaseLlmCost(
  price: PriceEntry, promptTokens: number, maxOutputTokens: number, cacheWriteMultiplier = 1,
): Micros {
  const inRate = (price.rates.inputPerMTok ?? 0) * cacheWriteMultiplier;
  const outRate = price.rates.outputPerMTok ?? 0;
  return Math.ceil((promptTokens * inRate + maxOutputTokens * outRate) / 1_000_000);
}

/**
 * Observed cost from usage. Cache pricing is not in the registry yet, so cache tokens
 * are priced as plain input; that over-states reads and may under-state writes.
 * TODO: add cache read/write rates to PriceEntry before enabling prompt caching.
 */
export function observedLlmCost(price: PriceEntry, usage: LlmUsage): Micros {
  const input = usage.input_tokens
    + (usage.cache_creation_input_tokens ?? 0)
    + (usage.cache_read_input_tokens ?? 0);
  return Math.ceil(
    (input * (price.rates.inputPerMTok ?? 0) + usage.output_tokens * (price.rates.outputPerMTok ?? 0)) / 1_000_000,
  );
}
