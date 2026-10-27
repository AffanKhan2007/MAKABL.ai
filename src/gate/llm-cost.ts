import type { Micros } from '../domain/types.ts';
import { tokenRatesFor, type PriceEntry, type TokenRates } from '../registry/pricing.ts';

/** Usage fields as returned on a Messages API response. */
export interface LlmUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  /** Breakdown of cache_creation_input_tokens by cache lifetime. */
  cache_creation?: {
    ephemeral_5m_input_tokens?: number | null;
    ephemeral_1h_input_tokens?: number | null;
  } | null;
}

export type CacheWrite = 'none' | '5m' | '1h';

const perMTok = (tokens: number, rate: Micros) => tokens * rate;

/**
 * Worst case for one model call (7.4 step 1): the whole prompt plus max_tokens of output.
 * If the request writes to the prompt cache, assume every prompt token is written at that
 * lifetime's rate, since a write costs more than plain input. The rate tier follows the
 * prompt length, so a long Haiku prompt is reserved at the long-prompt rates.
 */
export function worstCaseLlmCost(
  price: PriceEntry, promptTokens: number, maxOutputTokens: number, cacheWrite: CacheWrite = 'none',
): Micros {
  const r = tokenRatesFor(price, promptTokens);
  const inRate = cacheWrite === '5m' ? r.cacheWrite5mPerMTok
    : cacheWrite === '1h' ? r.cacheWrite1hPerMTok
    : r.inputPerMTok;
  return Math.ceil((perMTok(promptTokens, inRate) + perMTok(maxOutputTokens, r.outputPerMTok)) / 1_000_000);
}

/** Observed cost from a response's usage fields. */
export function observedLlmCost(price: PriceEntry, usage: LlmUsage): Micros {
  const written = usage.cache_creation_input_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  // The prompt-length tier counts every input token, cache reads and writes included.
  const r: TokenRates = tokenRatesFor(price, usage.input_tokens + written + read);

  // Without the per-lifetime breakdown we cannot tell 5m from 1h writes, so price them
  // all at the 1h rate: the figure may be high, never low.
  const w5m = usage.cache_creation ? usage.cache_creation.ephemeral_5m_input_tokens ?? 0 : 0;
  const w1h = usage.cache_creation ? usage.cache_creation.ephemeral_1h_input_tokens ?? 0 : written;
  // Any writes the breakdown does not account for are also priced at the 1h rate.
  const unattributed = Math.max(0, written - w5m - w1h);

  return Math.ceil((
    perMTok(usage.input_tokens, r.inputPerMTok)
    + perMTok(w5m, r.cacheWrite5mPerMTok)
    + perMTok(w1h + unattributed, r.cacheWrite1hPerMTok)
    + perMTok(read, r.cacheReadPerMTok)
    + perMTok(usage.output_tokens, r.outputPerMTok)
  ) / 1_000_000);
}
