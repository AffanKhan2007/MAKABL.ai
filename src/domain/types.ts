// Shared domain vocabulary. Mirrors the enums in db/schema.sql.

/** Money is held as integer micro-units (1 USD = 1_000_000) so cap checks never drift. */
export type Micros = number;
export type Currency = 'USD';

export const usd = (dollars: number): Micros => Math.round(dollars * 1_000_000);
export const toUsd = (m: Micros): number => m / 1_000_000;
export const fmtUsd = (m: Micros): string => `$${toUsd(m).toFixed(2)}`;

/** Where a figure came from (FR-16). */
export type CostBasis = 'estimated' | 'usage_observed' | 'invoice_confirmed';

/** How a cost line was priced (research section 18). */
export type LineClass =
  | 'exact'        // fixed price from the registry
  | 'conditional'  // exact if an assumption holds (e.g. traffic stays under a free limit)
  | 'empirical'    // derived from logged runs or priors
  | 'unpriced';    // known to exist, no defensible number; never summed into totals

export type CostCategory = 'one_time' | 'recurring' | 'usage_based' | 'optional';
export type Confidence = 'high' | 'medium' | 'low' | 'unverified';

export interface Range {
  low: Micros;
  expected: Micros;
  high: Micros;
}

export type Horizon = 'build_only' | 'first_month' | 'first_12_months';
export const horizonMonths: Record<Horizon, number> = {
  build_only: 0,
  first_month: 1,
  first_12_months: 12,
};
