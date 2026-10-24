import type { Confidence, Currency, Micros } from '../domain/types.ts';

export type CommercialUse = 'allowed' | 'prohibited' | 'unknown';

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
  rates: { inputPerMTok?: Micros; outputPerMTok?: Micros; flat?: Micros };
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
