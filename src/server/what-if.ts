import type { Horizon, Micros, Range } from '../domain/types.ts';
import type { Conflict } from '../estimator/conflicts.ts';
import { PRIOR_RETRY_RATE, type Phase } from '../estimator/estimator.ts';
import { MODELS, modelLabel, planWithConflicts, registry, type PlanOverrides } from './plan.ts';
import type { ProjectSpec } from './projects.ts';

// The what-if explorer (#21): change a knob, see the plan and its conflicts at once, then
// save the change as a new spec version. Everything here is plain data for a client
// component; nothing is saved until the user applies it.

export interface WhatIfPhase {
  phase: Phase;
  model: string;
  label: string;
  vendor: string;
  range: Range;
}

export interface WhatIfResult {
  paid: { totals: Range; eligible: boolean };
  free: { totals: Range; eligible: boolean };
  /** Model usage only: every relay phase, or the build alone. */
  modelCost: Range;
  phases: WhatIfPhase[];
  handoffs: Array<{ from: Phase; to: Phase; transcriptTokens: number; briefTokens: number; saved: Micros; crossVendor: boolean }>;
  handoffSavings: Micros;
  conflicts: Conflict[];
  assumptions: string[];
  /** Paid-path expected total minus the saved spec's. */
  delta: Micros;
}

export interface WhatIfState {
  result: WhatIfResult | null;
  error: string | null;
}

export const RETRY_CHOICES = [0, 0.25, 0.5, 1, 2] as const;
const HORIZONS = new Set<Horizon>(['build_only', 'first_month', 'first_12_months']);
const MODEL_IDS = new Set<string>(MODELS.map((m) => m.id));

const field = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

/** The spec the form describes, built on the saved one. */
export function parseWhatIf(
  spec: ProjectSpec, form: FormData,
): { spec: ProjectSpec; overrides: PlanOverrides } | { error: string } {
  const pick = (key: string) => {
    const id = field(form, key);
    return MODEL_IDS.has(id) ? id : null;
  };
  const buildModel = pick('model_build');
  if (!buildModel) return { error: 'Pick a build model.' };

  let relay: ProjectSpec['relay'] = null;
  if (form.get('relay') === 'on') {
    const s = pick('model_spec');
    const a = pick('model_architect');
    const r = pick('model_review');
    if (!s || !a || !r) return { error: 'Pick a model for every relay phase.' };
    relay = { spec: s, architect: a, review: r };
  }

  const retry = Number(field(form, 'retry'));
  if (!RETRY_CHOICES.includes(retry as typeof RETRY_CHOICES[number])) return { error: 'Pick a retry rate.' };
  const horizon = field(form, 'horizon') as Horizon;
  if (!HORIZONS.has(horizon)) return { error: 'Pick a horizon.' };
  const visitorsRaw = field(form, 'visitors');
  const visitors = visitorsRaw === '' ? null : Number(visitorsRaw);
  if (visitors !== null && (!Number.isInteger(visitors) || visitors < 0 || visitors > 100_000_000)) {
    return { error: 'Monthly visitors must be a whole number up to 100,000,000.' };
  }
  const buildDate = field(form, 'build_date');
  if (buildDate && !/^\d{4}-\d{2}-\d{2}$/.test(buildDate)) return { error: 'Build date must be a date.' };

  return {
    spec: {
      ...spec,
      buildModel,
      relay,
      retryRate: retry === PRIOR_RETRY_RATE ? null : retry,
      caching: form.get('caching') === 'on',
      commercialUse: form.get('commercial') === 'on',
      horizon,
      monthlyVisitors: visitors,
    },
    overrides: buildDate ? { buildDate } : {},
  };
}

export async function whatIf(
  spec: ProjectSpec, baselineExpected: Micros, ctx: { capMicros?: Micros; live?: boolean },
  overrides: PlanOverrides = {},
): Promise<WhatIfResult> {
  const { plan, conflicts } = await planWithConflicts(spec, ctx, overrides);
  const [free, paid] = plan.paths;
  const usage = paid.lines.filter((l) => l.phase && l.range);
  const modelCost = usage.reduce<Range>(
    (t, l) => ({ low: t.low + l.range!.low, expected: t.expected + l.range!.expected, high: t.high + l.range!.high }),
    { low: 0, expected: 0, high: 0 });
  const vendor = (id: string) => MODELS.find((m) => m.id === id)?.vendor ?? registry.get(id).provider;
  const phases: WhatIfPhase[] = plan.relay
    ? plan.relay.phases.map((p) => ({ phase: p.phase, model: p.model, label: modelLabel(p.model), vendor: vendor(p.model), range: p.range }))
    : [{ phase: 'build', model: spec.buildModel, label: modelLabel(spec.buildModel), vendor: vendor(spec.buildModel), range: modelCost }];
  return {
    paid: { totals: paid.totals, eligible: paid.eligible },
    free: { totals: free.totals, eligible: free.eligible },
    modelCost,
    phases,
    handoffs: plan.relay?.handoffs ?? [],
    handoffSavings: plan.relay?.handoffSavings ?? 0,
    conflicts,
    assumptions: plan.assumptions,
    delta: paid.totals.expected - baselineExpected,
  };
}
