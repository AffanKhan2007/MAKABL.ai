import { PgRunLog } from '../db/pg-run-log.ts';
import { findConflicts, type Conflict, type ConflictContext } from '../estimator/conflicts.ts';
import { estimate, type CostPlan, type EstimateInput, type RelayModels } from '../estimator/estimator.ts';
import { MODEL_CATALOG } from '../registry/models.ts';
import { PricingRegistry, tokenRatesFor } from '../registry/pricing.ts';
import { seedPrices } from '../registry/seed.ts';
import { db } from './db.ts';
import { liveModeStatus } from './live-mode.ts';
import type { ProjectSpec } from './projects.ts';

export const registry = new PricingRegistry(seedPrices);

/** Every model a phase can run on, across vendors, with its price for the pickers. */
export const MODELS = MODEL_CATALOG.map((m) => {
  const r = tokenRatesFor(registry.get(m.id), 0);
  return { ...m, input: r.inputPerMTok, output: r.outputPerMTok };
});

/** The build phase can run on any vendor in the plan; live builds check the adapter. */
export const BUILD_MODELS = MODELS;

export const modelLabel = (id: string): string => MODELS.find((m) => m.id === id)?.label ?? id;

/** A cheap model writes the spec, a strong one designs, a small one reviews. */
export const DEFAULT_RELAY: RelayModels = {
  spec: 'google/gemini-3.5-flash-lite',
  architect: 'openai/gpt-6.1-sol',
  review: 'anthropic/claude-haiku-5-5',
};

export const today = (): string => new Date().toISOString().slice(0, 10);

/** What-if knobs that are not saved on the spec. */
export interface PlanOverrides { buildDate?: string }

export function estimateInputFor(spec: ProjectSpec, overrides: PlanOverrides = {}): EstimateInput {
  const assumptions = {
    ...(spec.retryRate != null ? { retryRate: spec.retryRate } : {}),
    ...(spec.caching === false ? { caching: false } : {}),
    ...(overrides.buildDate ? { buildDate: overrides.buildDate } : {}),
  };
  return {
    features: spec.features,
    commercialUse: spec.commercialUse,
    buildModel: spec.buildModel,
    horizon: spec.horizon,
    ...(spec.monthlyVisitors ? { traffic: { monthlyVisitors: spec.monthlyVisitors } } : {}),
    unpricedItems: spec.unpricedItems,
    ...(spec.relay ? { relay: spec.relay } : {}),
    ...(Object.keys(assumptions).length ? { assumptions } : {}),
  };
}

const runsFor = (spec: ProjectSpec) =>
  new PgRunLog(db()).list({ featureTypes: spec.features.map((f) => f.type) });

/** The cost plan for a spec, from the registry and every logged calibration run. */
export async function planFor(spec: ProjectSpec, overrides: PlanOverrides = {}): Promise<CostPlan> {
  return estimate(estimateInputFor(spec, overrides), registry, await runsFor(spec), today());
}

/**
 * Why a vendor cannot run a live phase on this server, in words safe to show.
 */
export function liveBlocker(provider: string): string | null {
  if (provider === 'anthropic' || provider === 'google' || provider === 'openai' || provider === 'qwen') {
    const live = liveModeStatus(process.env, provider);
    return live.available ? null : live.missing.join('; ');
  }
  return `No live ${provider} adapter on this server yet`;
}

/** The plan plus its conflicts and shortcomings. */
export async function planWithConflicts(
  spec: ProjectSpec, ctx: Omit<ConflictContext, 'liveBlocker'> = {}, overrides: PlanOverrides = {},
): Promise<{ plan: CostPlan; conflicts: Conflict[] }> {
  const input = estimateInputFor(spec, overrides);
  const runs = await runsFor(spec);
  const plan = estimate(input, registry, runs, today());
  return { plan, conflicts: findConflicts(input, plan, registry, runs, today(), { ...ctx, liveBlocker }) };
}

/**
 * Easy mode's budget preset selects the cheapest supported live build model. Balanced and
 * Best remain higher-cost Claude options. Budget plans for an extra attempt per feature.
 */
export const PRESETS = {
  budget: {
    label: 'Budget', blurb: 'Smaller AI models. Cheapest, with more retries.',
    relay: { spec: 'google/gemini-3.5-flash-lite', architect: 'google/gemini-3.6-flash', review: 'google/gemini-3.5-flash-lite' },
    buildModel: 'google/gemini-3.6-flash', retryRate: 1,
  },
  balanced: {
    label: 'Balanced', blurb: 'Strong where it matters, cheap elsewhere.',
    relay: DEFAULT_RELAY, buildModel: 'anthropic/claude-sonnet-5-5', retryRate: null,
  },
  best: {
    label: 'Best quality', blurb: 'The most capable models at every step.',
    relay: { spec: 'anthropic/claude-sonnet-5-5', architect: 'anthropic/claude-fable-5-1', review: 'anthropic/claude-sonnet-5-5' },
    buildModel: 'anthropic/claude-opus-5-5', retryRate: null,
  },
} as const satisfies Record<string, { label: string; blurb: string; relay: RelayModels; buildModel: string; retryRate: number | null }>;

export type PresetId = keyof typeof PRESETS;

/** The spec with a preset's models applied. */
export function withPreset(spec: ProjectSpec, id: PresetId): ProjectSpec {
  const p = PRESETS[id];
  return { ...spec, relay: { ...p.relay }, buildModel: p.buildModel, retryRate: p.retryRate, caching: true };
}

/** Which preset the spec matches exactly, if any. */
export function presetOf(spec: ProjectSpec): PresetId | null {
  for (const id of Object.keys(PRESETS) as PresetId[]) {
    const p = PRESETS[id];
    // Field by field: the spec comes back from jsonb, which does not keep key order.
    if (spec.buildModel === p.buildModel && (spec.retryRate ?? null) === p.retryRate && spec.caching !== false
      && spec.relay?.spec === p.relay.spec && spec.relay.architect === p.relay.architect
      && spec.relay.review === p.relay.review) return id;
  }
  return null;
}

/** Each preset's plan for this spec, sharing one read of the run log. */
export async function presetPlans(spec: ProjectSpec): Promise<Record<PresetId, CostPlan>> {
  const runs = await runsFor(spec);
  const out = {} as Record<PresetId, CostPlan>;
  for (const id of Object.keys(PRESETS) as PresetId[]) {
    out[id] = estimate(estimateInputFor(withPreset(spec, id)), registry, runs, today());
  }
  return out;
}
