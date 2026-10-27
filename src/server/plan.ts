import { PgRunLog } from '../db/pg-run-log.ts';
import { estimate, type CostPlan } from '../estimator/estimator.ts';
import { PricingRegistry } from '../registry/pricing.ts';
import { seedPrices } from '../registry/seed.ts';
import { db } from './db.ts';
import type { ProjectSpec } from './projects.ts';

export const registry = new PricingRegistry(seedPrices);

export const BUILD_MODELS = [
  { id: 'anthropic/claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'anthropic/claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'anthropic/claude-haiku-5-5', label: 'Claude Haiku 5.5' },
] as const;

/** The cost plan for a spec, from the registry and every logged calibration run. */
export async function planFor(spec: ProjectSpec): Promise<CostPlan> {
  const runs = await new PgRunLog(db()).list({ featureTypes: spec.features.map((f) => f.type) });
  return estimate(
    {
      features: spec.features,
      commercialUse: spec.commercialUse,
      buildModel: spec.buildModel,
      horizon: spec.horizon,
      ...(spec.monthlyVisitors ? { traffic: { monthlyVisitors: spec.monthlyVisitors } } : {}),
      unpricedItems: spec.unpricedItems,
    },
    registry,
    runs,
    new Date().toISOString().slice(0, 10),
  );
}
