import {
  horizonMonths,
  type CostCategory, type Confidence, type Horizon, type LineClass, type Micros, type Range,
} from '../domain/types.ts';
import type { PriceEntry, PricingRegistry } from '../registry/pricing.ts';

// Estimator (working model 7.2-7.3, research section 18).
// Build cost is reference-class forecasting: tokens per feature type from logged runs.
// Below MIN_CALIBRATION_RUNS the range is deliberately wide and confidence is low.
// The model's own estimate of its cost is never used.

export type FeatureType =
  | 'crud_endpoint' | 'auth' | 'form_page' | 'page' | 'migration' | 'integration';

export interface FeatureRequest {
  type: FeatureType;
  name: string;
}

export interface EstimateInput {
  features: FeatureRequest[];
  /** Client or paid work. Free tiers that prohibit commercial use are blocked (D11). */
  commercialUse: boolean;
  buildModel: string;               // registry id, e.g. anthropic/claude-opus-5-5
  horizon: Horizon;
  /** Things the plan knows exist but cannot price (domain, third-party APIs). */
  unpricedItems?: string[];
}

/** One logged build run, used to calibrate per-feature-type estimates. */
export interface CalibrationRun {
  featureType: FeatureType;
  inputTokens: number;
  outputTokens: number;
  attempts: number;
}

export interface CostLine {
  label: string;
  category: CostCategory;
  lineClass: LineClass;
  unit: string;
  quantityAssumption: string;
  range: Range | null;              // null only when lineClass is 'unpriced'
  rateSource: string | null;
  confidence: Confidence;
  priceIsAssumption: boolean;
  warnings: string[];
}

export interface PathPlan {
  path: 'free' | 'paid';
  eligible: boolean;
  ineligibleReasons: string[];
  lines: CostLine[];
  totals: Range;                    // sum of priced lines only
  unpriced: CostLine[];
  upgradeCliffs: string[];
}

export interface CostPlan {
  horizon: Horizon;
  assumptions: string[];
  calibration: { runs: number; calibrated: boolean };
  paths: [PathPlan, PathPlan];
  disclosures: string[];
}

export const MIN_CALIBRATION_RUNS = 10;

/** Uncalibrated per-feature priors (tokens for one successful attempt). Rough on purpose. */
const PRIOR_TOKENS: Record<FeatureType, { input: number; output: number }> = {
  crud_endpoint: { input: 60_000, output: 12_000 },
  auth: { input: 150_000, output: 30_000 },
  form_page: { input: 50_000, output: 10_000 },
  page: { input: 40_000, output: 10_000 },
  migration: { input: 30_000, output: 6_000 },
  integration: { input: 120_000, output: 25_000 },
};
/** Wide multipliers while uncalibrated: research shows several-fold spread with a 30x tail. */
const PRIOR_BAND = { low: 0.5, high: 6 };
const PRIOR_RETRY_RATE = 0.5;       // extra attempts per feature, until runs say otherwise

const PATHS = {
  free: { host: 'vercel/hobby', database: 'supabase/free', git: 'github/free' },
  paid: { host: 'vercel/pro', database: 'supabase/pro', git: 'github/free' },
} as const;

export const DISCLOSURES = [
  'Ranges, not a bill. Build cost for identical tasks can vary by an order of magnitude.',
  'Spend at the host and database after deployment is outside the Budget Gate; set provider-side limits too.',
  'Free path means no new paid charge without your approval, not guaranteed zero cost.',
  'Unpriced items are listed separately and are not included in totals.',
];

function tokenCost(price: PriceEntry, input: number, output: number): Micros {
  const inRate = price.rates.inputPerMTok ?? 0;
  const outRate = price.rates.outputPerMTok ?? 0;
  return Math.round((input * inRate + output * outRate) / 1_000_000);
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) throw new Error('percentile of empty list');
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (idx - lo);
}

function buildLine(
  feature: FeatureRequest, model: PriceEntry, runs: CalibrationRun[], today: string,
  registry: PricingRegistry,
): CostLine {
  const sameType = runs.filter((r) => r.featureType === feature.type);
  const priceIsAssumption = registry.isAssumption(model.id, today);
  const warnings: string[] = [];

  if (sameType.length >= MIN_CALIBRATION_RUNS) {
    // Each run already includes its retries, so the empirical P10/P50/P90 covers them.
    const costs = sameType
      .map((r) => tokenCost(model, r.inputTokens, r.outputTokens))
      .sort((a, b) => a - b);
    return {
      label: `Build: ${feature.name}`,
      category: 'usage_based', lineClass: 'empirical', unit: 'tokens',
      quantityAssumption: `P10/P50/P90 of ${sameType.length} logged ${feature.type} runs`,
      range: {
        low: Math.round(percentile(costs, 0.1)),
        expected: Math.round(percentile(costs, 0.5)),
        high: Math.round(percentile(costs, 0.9)),
      },
      rateSource: model.id,
      confidence: 'medium',
      priceIsAssumption, warnings,
    };
  }

  const prior = PRIOR_TOKENS[feature.type];
  const once = tokenCost(model, prior.input, prior.output);
  warnings.push(
    `Only ${sameType.length} logged ${feature.type} runs (need ${MIN_CALIBRATION_RUNS}); range is wide`,
  );
  return {
    label: `Build: ${feature.name}`,
    category: 'usage_based', lineClass: 'empirical', unit: 'tokens',
    quantityAssumption:
      `Prior ~${prior.input / 1000}K in / ${prior.output / 1000}K out per attempt, ` +
      `${1 + PRIOR_RETRY_RATE} attempts expected`,
    range: {
      low: Math.round(once * PRIOR_BAND.low),
      expected: Math.round(once * (1 + PRIOR_RETRY_RATE)),
      high: Math.round(once * PRIOR_BAND.high),
    },
    rateSource: model.id,
    confidence: 'low',
    priceIsAssumption, warnings,
  };
}

function subscriptionLine(
  price: PriceEntry, months: number, commercialUse: boolean, today: string,
  registry: PricingRegistry,
): CostLine {
  const flat = price.rates.flat ?? 0;
  const amount = flat * months;
  const warnings: string[] = [...(price.freeLimits ?? [])];
  if (commercialUse && price.commercialUse === 'prohibited') {
    warnings.unshift(`Not allowed for commercial use: ${price.commercialNote ?? price.plan}`);
  } else if (commercialUse && price.commercialUse === 'unknown') {
    warnings.unshift('Commercial-use terms not confirmed for this plan');
  }
  const free = flat === 0;
  return {
    label: `${price.provider} ${price.plan} (${price.category})`,
    category: 'recurring',
    // A free tier is only free while usage stays under its limits.
    lineClass: free ? 'conditional' : 'exact',
    unit: price.unit,
    quantityAssumption: free
      ? `${months} month(s), assuming usage stays inside free limits`
      : `${months} month(s) x 1 ${price.unit}`,
    range: { low: amount, expected: amount, high: amount },
    rateSource: price.id,
    confidence: price.confidence,
    priceIsAssumption: registry.isAssumption(price.id, today),
    warnings,
  };
}

function sum(lines: CostLine[]): Range {
  return lines.reduce<Range>(
    (acc, l) => (l.range
      ? { low: acc.low + l.range.low, expected: acc.expected + l.range.expected, high: acc.high + l.range.high }
      : acc),
    { low: 0, expected: 0, high: 0 },
  );
}

export function estimate(
  input: EstimateInput, registry: PricingRegistry, runs: CalibrationRun[], today: string,
): CostPlan {
  const model = registry.get(input.buildModel);
  const months = horizonMonths[input.horizon];
  const buildLines = input.features.map((f) => buildLine(f, model, runs, today, registry));
  const unpriced: CostLine[] = (input.unpricedItems ?? []).map((label) => ({
    label, category: 'optional', lineClass: 'unpriced', unit: 'n/a',
    quantityAssumption: 'Not estimated', range: null, rateSource: null,
    confidence: 'unverified', priceIsAssumption: true, warnings: [],
  }));

  const paths = (['free', 'paid'] as const).map((path): PathPlan => {
    const ids = PATHS[path];
    const opLines = months === 0
      ? []
      : [ids.host, ids.database, ids.git].map((id) =>
        subscriptionLine(registry.get(id), months, input.commercialUse, today, registry));
    const ineligibleReasons = input.commercialUse
      ? [ids.host, ids.database, ids.git]
        .map((id) => registry.get(id))
        .filter((p) => p.commercialUse === 'prohibited')
        .map((p) => `${p.provider} ${p.plan}: ${p.commercialNote ?? 'commercial use prohibited'}`)
      : [];
    const lines = [...buildLines, ...opLines];
    return {
      path,
      eligible: ineligibleReasons.length === 0,
      ineligibleReasons,
      lines,
      totals: sum(lines),
      unpriced,
      upgradeCliffs: [ids.host, ids.database]
        .map((id) => registry.get(id))
        .filter((p) => p.upgradeCliff)
        .map((p) => `${p.provider} ${p.plan}: ${p.upgradeCliff}`),
    };
  }) as [PathPlan, PathPlan];

  const calibratedTypes = new Set(input.features.map((f) => f.type));
  const relevantRuns = runs.filter((r) => calibratedTypes.has(r.featureType)).length;
  return {
    horizon: input.horizon,
    assumptions: [
      `Build model: ${model.product}`,
      `Commercial use: ${input.commercialUse ? 'yes' : 'no'}`,
      `Horizon: ${input.horizon} (${months} month(s) of hosting)`,
    ],
    calibration: {
      runs: relevantRuns,
      calibrated: input.features.every(
        (f) => runs.filter((r) => r.featureType === f.type).length >= MIN_CALIBRATION_RUNS,
      ),
    },
    paths,
    disclosures: DISCLOSURES,
  };
}
