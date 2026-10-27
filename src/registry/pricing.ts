import type { Confidence, Currency, Micros } from '../domain/types.ts';

export type CommercialUse = 'allowed' | 'prohibited' | 'unknown';

/** Per-1M-token rates for one model at one prompt-length tier. */
export interface TokenRates {
  inputPerMTok: Micros;
  outputPerMTok: Micros;
  /** Prompt-cache writes, by cache lifetime. */
  cacheWrite5mPerMTok: Micros;
  cacheWrite1hPerMTok: Micros;
  /** Cache hits and refreshes. */
  cacheReadPerMTok: Micros;
}

export type MeterId = 'function_invocations' | 'active_cpu' | 'provisioned_memory' | 'fast_data_transfer';

/** A usage-billed resource: `price` per `perUnits` of `unit`. */
export interface Meter {
  id: MeterId;
  unit: string;
  perUnits: number;
  price: Micros;
  /** The provider publishes this as a "starting at" price; some regions cost more. */
  startingAt?: boolean;
}

/** One versioned price (working model 7.6). */
export interface PriceEntry {
  id: string;
  provider: string;
  product: string;
  plan: string;
  category: 'llm' | 'host' | 'database' | 'git' | 'domain';
  currency: Currency;
  unit: string;
  /** LLM: per 1M tokens. Subscriptions: flat per billing period. */
  rates: Partial<TokenRates> & { flat?: Micros };
  /**
   * Higher rates for long prompts. A request whose total input (including cache reads
   * and writes) is over `overTokens` pays these rates for all of its tokens.
   */
  longPrompt?: { overTokens: number; rates: TokenRates };
  /** Usage charges on top of the flat fee. */
  meters?: Meter[];
  /** Monthly usage included in the plan, in each meter's unit. */
  includedUsage?: Partial<Record<MeterId, number>>;
  /** Monthly credit that usage charges draw down before they are billed. */
  includedCredit?: Micros;
  billingPeriod: 'month' | 'year' | 'usage';
  freeLimits?: string[];
  /** What happens when you outgrow the plan; shown as the "upgrade cliff" (FR-10). */
  upgradeCliff?: string;
  commercialUse: CommercialUse;
  commercialNote?: string;
  sourceUrl: string;
  /** ISO date this was checked against the official source; null = never. */
  verifiedAt: string | null;
  confidence: Confidence;
  revalidateAfter: string | null;
}

/** The token rates that apply to one request with `promptTokens` of total input. */
export function tokenRatesFor(price: PriceEntry, promptTokens: number): TokenRates {
  if (price.longPrompt && promptTokens > price.longPrompt.overTokens) return price.longPrompt.rates;
  const r = price.rates;
  if (r.inputPerMTok === undefined || r.outputPerMTok === undefined) {
    throw new Error(`${price.id} has no token rates`);
  }
  return {
    inputPerMTok: r.inputPerMTok,
    outputPerMTok: r.outputPerMTok,
    // Missing cache rates fall back to the most expensive plausible value, never cheaper.
    cacheWrite5mPerMTok: r.cacheWrite5mPerMTok ?? r.inputPerMTok * 2,
    cacheWrite1hPerMTok: r.cacheWrite1hPerMTok ?? r.inputPerMTok * 2,
    cacheReadPerMTok: r.cacheReadPerMTok ?? r.inputPerMTok,
  };
}

export class PricingRegistry {
  private readonly entries = new Map<string, PriceEntry>();

  constructor(entries: PriceEntry[]) {
    for (const e of entries) this.entries.set(e.id, e);
  }

  get(id: string): PriceEntry {
    const e = this.entries.get(id);
    if (!e) throw new Error(`unknown price id: ${id}`);
    return e;
  }

  find(id: string): PriceEntry | undefined {
    return this.entries.get(id);
  }

  /** LLM price entries, for bounding a model the registry does not know. */
  llms(): PriceEntry[] {
    return [...this.entries.values()].filter((e) => e.category === 'llm');
  }

  /**
   * Rule from 7.6: a price older than revalidate_after, or never verified from an
   * official source, is an assumption and needs confirmation before a paid commitment.
   */
  isAssumption(id: string, today: string): boolean {
    const e = this.get(id);
    if (e.verifiedAt === null) return true;
    return e.revalidateAfter !== null && today > e.revalidateAfter;
  }
}
