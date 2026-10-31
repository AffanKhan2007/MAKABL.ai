import type { CalibrationRun, FeatureType } from '../calibration/runs.ts';
import {
  horizonMonths,
  type CostCategory, type Confidence, type Horizon, type LineClass, type Micros, type Range,
} from '../domain/types.ts';
import { observedLlmCost, type LlmUsage } from '../gate/llm-cost.ts';
import { tokenRatesFor, type MeterId, type PriceEntry, type PricingRegistry } from '../registry/pricing.ts';

export type { CalibrationRun, FeatureType } from '../calibration/runs.ts';

// Estimator (working model 7.2-7.3, research section 18).
//
// Build cost, best evidence first:
//   1. Probe-then-quote: a cheap probe run on this task, scaled by the full/probe cost
//      ratios of past runs of the same feature type.
//   2. Reference class: P10/P50/P90 of the logged cost of past runs of the same type.
//   3. Prior: a modelled agent loop with prompt caching, deliberately wide, low confidence.
// The model's own estimate of its cost is never used.
//
// Running cost: flat plan fees, plus usage charges derived from the expected traffic.

export interface FeatureRequest {
  type: FeatureType;
  name: string;
}

/** Expected traffic once live. Every field but monthlyVisitors has a stated default. */
export interface TrafficInput {
  monthlyVisitors: number;
  pagesPerVisit?: number;
  /** Serverless function calls per page view (API routes, server rendering). */
  functionCallsPerPage?: number;
  cpuMsPerCall?: number;
  /** Wall-clock duration per call, which provisioned memory is billed on. */
  wallMsPerCall?: number;
  memoryGb?: number;
  kbPerPage?: number;
}

export interface EstimateInput {
  features: FeatureRequest[];
  /** Client or paid work. Free tiers that prohibit commercial use are blocked (D11). */
  commercialUse: boolean;
  buildModel: string;               // registry id, e.g. anthropic/claude-opus-5-5
  horizon: Horizon;
  traffic?: TrafficInput;
  /** Probe run costs for this project, keyed by feature name. */
  probes?: Record<string, Micros>;
  /** Things the plan knows exist but cannot price (domain, third-party APIs). */
  unpricedItems?: string[];
  /** Models for the relay phases around the build. Omitted: a build-only plan. */
  relay?: RelayModels;
  /** Knobs the what-if explorer turns. Each has a stated default. */
  assumptions?: EstimateAssumptions;
}

/**
 * The relay: each phase runs on its own model and hands the next a short brief instead of
 * its whole transcript. The build phase uses `buildModel`.
 */
export type Phase = 'spec' | 'architect' | 'build' | 'review';
export const PHASES: readonly Phase[] = ['spec', 'architect', 'build', 'review'];
export type RelayModels = Record<Exclude<Phase, 'build'>, string>;

export interface EstimateAssumptions {
  /** Extra build attempts per feature while uncalibrated. Default PRIOR_RETRY_RATE. */
  retryRate?: number;
  /** Prompt caching in the agent loop. Default true. */
  caching?: boolean;
  /** ISO date the build runs, for announced price changes. Default: today. */
  buildDate?: string;
}

export interface HandoffEstimate {
  from: Phase;
  to: Phase;
  /** Tokens the next phase would carry if it got the whole transcript. */
  transcriptTokens: number;
  briefTokens: number;
  /** What sending the transcript instead of the brief would add, over the next phase's turns. */
  saved: Micros;
  /** The two phases run on different vendors, so no prompt cache carries over. */
  crossVendor: boolean;
}

export interface RelayPhaseEstimate {
  phase: Phase;
  model: string;
  provider: string;
  range: Range;
}

export interface RelayPlan {
  phases: RelayPhaseEstimate[];
  handoffs: HandoffEstimate[];
  handoffSavings: Micros;
}

export interface CostLine {
  label: string;
  /** Set on model-usage lines: the relay phase they belong to. */
  phase?: Phase;
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

/** How often past quotes contained the real cost (research section 18: publish calibration). */
export interface Coverage {
  quotedRuns: number;
  inRange: number;
  /** null until MIN_CALIBRATION_RUNS quoted runs exist: too few to say. */
  share: number | null;
}

export interface CostPlan {
  horizon: Horizon;
  assumptions: string[];
  calibration: { runs: number; calibrated: boolean; coverage: Coverage };
  paths: [PathPlan, PathPlan];
  /** Present when the input names relay models. */
  relay?: RelayPlan;
  disclosures: string[];
}

export const MIN_CALIBRATION_RUNS = 10;
const HIGH_CONFIDENCE_RUNS = 30;

/**
 * One attempt of an agent loop, before any runs are logged. Rough on purpose.
 * Turn i sends baseContext + i * growthPerTurn tokens; everything but the newest part
 * is a cache read, the newest part is a 5-minute cache write.
 */
interface LoopPrior { turns: number; baseContext: number; growthPerTurn: number; outputPerTurn: number }

const PRIOR_LOOP: Record<FeatureType, LoopPrior> = {
  crud_endpoint: { turns: 8, baseContext: 8_000, growthPerTurn: 1_500, outputPerTurn: 1_500 },
  auth: { turns: 12, baseContext: 10_000, growthPerTurn: 2_000, outputPerTurn: 2_500 },
  form_page: { turns: 7, baseContext: 7_000, growthPerTurn: 1_500, outputPerTurn: 1_500 },
  page: { turns: 6, baseContext: 7_000, growthPerTurn: 1_500, outputPerTurn: 1_600 },
  migration: { turns: 4, baseContext: 6_000, growthPerTurn: 1_200, outputPerTurn: 1_500 },
  integration: { turns: 12, baseContext: 9_000, growthPerTurn: 2_000, outputPerTurn: 2_000 },
};
/** Wide multipliers while uncalibrated: research shows several-fold spread with a 30x tail. */
const PRIOR_BAND = { low: 0.5, high: 6 };
export const PRIOR_RETRY_RATE = 0.5; // extra attempts per feature, until runs say otherwise

/**
 * Relay phases other than build. Spec and architect run once per project, review once per
 * feature. No runs are logged for them yet, so they always use these priors.
 */
const PHASE_LOOP: Record<Exclude<Phase, 'build'>, LoopPrior> = {
  spec: { turns: 2, baseContext: 3_000, growthPerTurn: 1_000, outputPerTurn: 2_500 },
  architect: { turns: 3, baseContext: 6_000, growthPerTurn: 2_000, outputPerTurn: 4_000 },
  review: { turns: 2, baseContext: 5_000, growthPerTurn: 1_500, outputPerTurn: 1_000 },
};
/** Single-pass phases spread less than a build loop, but a checkpoint can still bounce them. */
const PHASE_BAND = { low: 0.5, high: 3 };
/** Size of the brief a finishing phase writes for the next one. */
export const BRIEF_TOKENS = 2_000;

const TRAFFIC_DEFAULTS: Required<Omit<TrafficInput, 'monthlyVisitors'>> = {
  pagesPerVisit: 4, functionCallsPerPage: 2, cpuMsPerCall: 50, wallMsPerCall: 300, memoryGb: 2, kbPerPage: 1_500,
};
/** Low/high traffic as multiples of what the user expects. */
const TRAFFIC_BAND = { low: 0.5, high: 3 };

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

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) throw new Error('percentile of empty list');
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (idx - lo);
}

const spread = (values: number[]): Range => {
  const s = [...values].sort((a, b) => a - b);
  return {
    low: Math.round(percentile(s, 0.1)),
    expected: Math.round(percentile(s, 0.5)),
    high: Math.round(percentile(s, 0.9)),
  };
};

export interface LoopOptions { caching?: boolean; onDate?: string }

/**
 * Cost of one attempt of an agent loop. With caching off, every turn resends its whole
 * context as plain input.
 */
export function loopCost(price: PriceEntry, p: LoopPrior, opts: LoopOptions = {}): Micros {
  let total = 0;
  for (let i = 0; i < p.turns; i++) {
    const cached = i === 0 ? 0 : p.baseContext + (i - 1) * p.growthPerTurn;
    const fresh = i === 0 ? p.baseContext : p.growthPerTurn;
    total += observedLlmCost(price, opts.caching === false
      ? { input_tokens: cached + fresh, output_tokens: p.outputPerTurn }
      : {
        input_tokens: 0,
        output_tokens: p.outputPerTurn,
        cache_read_input_tokens: cached,
        cache_creation_input_tokens: fresh,
        cache_creation: { ephemeral_5m_input_tokens: fresh, ephemeral_1h_input_tokens: 0 },
      }, opts.onDate);
  }
  return total;
}

/** Tokens a loop's transcript holds when it ends: its context plus everything it wrote. */
const transcriptTokens = (p: LoopPrior) => p.baseContext + p.turns * (p.growthPerTurn + p.outputPerTurn);

/**
 * What the next phase would pay to carry `extra` more context tokens on each of its turns:
 * written once, then read from cache (or resent as input with caching off).
 */
function carryCost(price: PriceEntry, p: LoopPrior, extra: number, opts: LoopOptions): Micros {
  if (extra <= 0) return 0;
  const r = tokenRatesFor(price, p.baseContext + extra, opts.onDate);
  const perTurn = opts.caching === false ? r.inputPerMTok : r.cacheReadPerMTok;
  const first = opts.caching === false ? r.inputPerMTok : r.cacheWrite5mPerMTok;
  return Math.ceil((extra * first + extra * (p.turns - 1) * perTurn) / 1_000_000);
}

/**
 * What a logged run would have cost on `price`. Same model: the booked cost. Another
 * model: re-priced from its token totals, spread evenly over its calls so long-prompt
 * tiers apply per call as they would have.
 */
export function runCostOn(run: CalibrationRun, price: PriceEntry, onDate?: string): Micros {
  if (run.model === price.id && !price.priceChanges?.length) return run.cost;
  const n = run.calls;
  const t = run.tokens;
  const perCall: LlmUsage = {
    input_tokens: t.input / n,
    output_tokens: t.output / n,
    cache_read_input_tokens: t.cacheRead / n,
    cache_creation_input_tokens: (t.cacheWrite5m + t.cacheWrite1h) / n,
    cache_creation: { ephemeral_5m_input_tokens: t.cacheWrite5m / n, ephemeral_1h_input_tokens: t.cacheWrite1h / n },
  };
  return observedLlmCost(price, perCall, onDate) * n;
}

export function coverage(runs: CalibrationRun[]): Coverage {
  const quoted = runs.filter((r) => r.quoted);
  const inRange = quoted.filter((r) => r.cost >= r.quoted!.low && r.cost <= r.quoted!.high).length;
  return {
    quotedRuns: quoted.length,
    inRange,
    share: quoted.length >= MIN_CALIBRATION_RUNS ? inRange / quoted.length : null,
  };
}

const confidenceFor = (n: number): Confidence => (n >= HIGH_CONFIDENCE_RUNS ? 'high' : 'medium');

interface BuildOptions extends LoopOptions { retryRate: number }

function buildLine(
  feature: FeatureRequest, model: PriceEntry, runs: CalibrationRun[], probe: Micros | undefined,
  priceIsAssumption: boolean, opts: BuildOptions,
): CostLine {
  const costOn = (r: CalibrationRun) => runCostOn(r, model, opts.onDate);
  const sameType = runs.filter((r) => r.featureType === feature.type);
  const base = {
    label: `Build: ${feature.name}`,
    phase: 'build' as const,
    category: 'usage_based' as const,
    lineClass: 'empirical' as const,
    unit: 'tokens',
    rateSource: model.id,
    priceIsAssumption,
  };
  const warnings: string[] = [];

  if (probe !== undefined) {
    const paired = sameType.filter((r) => r.probeCost !== undefined && r.probeCost > 0);
    if (paired.length >= MIN_CALIBRATION_RUNS) {
      const ratios = spread(paired.map((r) => costOn(r) / r.probeCost!));
      return {
        ...base,
        quantityAssumption:
          `Probe run cost ${(probe / 1_000_000).toFixed(4)} USD x P10/P50/P90 of ` +
          `${paired.length} logged full/probe cost ratios`,
        range: {
          low: Math.round(probe * ratios.low),
          expected: Math.round(probe * ratios.expected),
          high: Math.round(probe * ratios.high),
        },
        confidence: confidenceFor(paired.length),
        warnings,
      };
    }
    warnings.push(`Probe not used: only ${paired.length} past ${feature.type} runs have a probe (need ${MIN_CALIBRATION_RUNS})`);
  }

  if (sameType.length >= MIN_CALIBRATION_RUNS) {
    // Each run already includes its retries, so the percentiles cover them.
    return {
      ...base,
      quantityAssumption: `P10/P50/P90 of ${sameType.length} logged ${feature.type} runs`,
      range: spread(sameType.map(costOn)),
      confidence: confidenceFor(sameType.length),
      warnings,
    };
  }

  const prior = PRIOR_LOOP[feature.type];
  const once = loopCost(model, prior, opts);
  const retry = opts.retryRate;
  warnings.push(
    `Only ${sameType.length} logged ${feature.type} runs (need ${MIN_CALIBRATION_RUNS}); range is wide`,
  );
  return {
    ...base,
    quantityAssumption:
      `Prior: ${prior.turns}-turn cached agent loop, ${prior.baseContext / 1000}K starting context, ` +
      `+${prior.growthPerTurn / 1000}K and ${prior.outputPerTurn / 1000}K output per turn; ` +
      `${1 + retry} attempts expected${opts.caching === false ? '; no prompt caching' : ''}`,
    range: {
      low: Math.round(once * PRIOR_BAND.low),
      expected: Math.round(once * (1 + retry)),
      high: Math.round(once * PRIOR_BAND.high),
    },
    confidence: 'low',
    warnings,
  };
}

const PHASE_LABEL: Record<Phase, string> = {
  spec: 'Spec', architect: 'Architecture', build: 'Build', review: 'Review',
};

/** One relay phase other than build, priced from its prior. Review runs once per feature. */
function phaseLine(
  phase: Exclude<Phase, 'build'>, model: PriceEntry, features: number, priceIsAssumption: boolean,
  opts: LoopOptions,
): CostLine {
  const prior = PHASE_LOOP[phase];
  const times = phase === 'review' ? features : 1;
  const once = loopCost(model, prior, opts) * times;
  return {
    label: `${PHASE_LABEL[phase]} on ${model.product}`,
    phase,
    category: 'usage_based',
    lineClass: 'empirical',
    unit: 'tokens',
    quantityAssumption:
      `Prior: ${times > 1 ? `${times} x ` : ''}${prior.turns}-turn pass from a ${BRIEF_TOKENS / 1000}K brief, ` +
      `${prior.baseContext / 1000}K context, ${prior.outputPerTurn / 1000}K output per turn` +
      `${opts.caching === false ? '; no prompt caching' : ''}`,
    range: {
      low: Math.round(once * PHASE_BAND.low),
      expected: once,
      high: Math.round(once * PHASE_BAND.high),
    },
    rateSource: model.id,
    confidence: 'low',
    priceIsAssumption,
    warnings: ['No logged runs for this phase yet; range is a prior'],
  };
}

/**
 * Handoffs between consecutive phases: what each next phase would pay to carry the whole
 * transcript of the one before instead of a brief. Build hands each feature's transcript to
 * that feature's review.
 */
function handoffs(
  features: FeatureRequest[], models: Record<Phase, PriceEntry>, opts: LoopOptions,
): HandoffEstimate[] {
  const buildTranscript = features.reduce((t, f) => t + transcriptTokens(PRIOR_LOOP[f.type]), 0);
  const avgBuild: LoopPrior = {
    turns: Math.max(1, Math.round(features.reduce((t, f) => t + PRIOR_LOOP[f.type].turns, 0) / Math.max(1, features.length))),
    baseContext: 8_000, growthPerTurn: 0, outputPerTurn: 0,
  };
  const legs: Array<{ from: Phase; to: Phase; transcript: number; next: LoopPrior; times: number }> = [
    { from: 'spec', to: 'architect', transcript: transcriptTokens(PHASE_LOOP.spec), next: PHASE_LOOP.architect, times: 1 },
    // Every feature's build starts from the architect's output.
    { from: 'architect', to: 'build', transcript: transcriptTokens(PHASE_LOOP.architect), next: avgBuild, times: features.length },
    { from: 'build', to: 'review', transcript: buildTranscript / Math.max(1, features.length), next: PHASE_LOOP.review, times: features.length },
  ];
  return legs.map((l) => ({
    from: l.from,
    to: l.to,
    transcriptTokens: Math.round(l.transcript),
    briefTokens: BRIEF_TOKENS,
    saved: carryCost(models[l.to], l.next, l.transcript - BRIEF_TOKENS, opts) * l.times,
    crossVendor: models[l.from].provider !== models[l.to].provider,
  }));
}

function subscriptionLine(
  price: PriceEntry, months: number, commercialUse: boolean, priceIsAssumption: boolean,
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
    priceIsAssumption,
    warnings,
  };
}

type Usage = Record<MeterId, number>;

/** Monthly usage in each meter's unit, at `scale` times the expected traffic. */
function monthlyUsage(t: TrafficInput, scale: number): Usage {
  const d = { ...TRAFFIC_DEFAULTS, ...t };
  const pageViews = t.monthlyVisitors * d.pagesPerVisit * scale;
  const calls = pageViews * d.functionCallsPerPage;
  return {
    function_invocations: calls,
    active_cpu: (calls * d.cpuMsPerCall) / 3_600_000,
    provisioned_memory: (calls * d.wallMsPerCall * d.memoryGb) / 3_600_000,
    fast_data_transfer: (pageViews * d.kbPerPage) / 1_000_000,
  };
}

function trafficAssumption(t: TrafficInput): string {
  const d = { ...TRAFFIC_DEFAULTS, ...t };
  return `${t.monthlyVisitors.toLocaleString('en-US')} visitors/month x ${d.pagesPerVisit} pages, ` +
    `${d.functionCallsPerPage} function calls/page at ${d.cpuMsPerCall} ms CPU, ${d.wallMsPerCall} ms wall, ` +
    `${d.memoryGb} GB; ${d.kbPerPage} KB/page`;
}

/** Usage charges above the plan's included credit, per month, at one traffic level. */
function overage(price: PriceEntry, usage: Usage): Micros {
  const charges = (price.meters ?? []).reduce((sum, m) => sum + (usage[m.id] / m.perUnits) * m.price, 0);
  return Math.max(0, Math.round(charges - (price.includedCredit ?? 0)));
}

/** Free-tier guideline checks: which meters the traffic exceeds. */
function exceeded(price: PriceEntry, usage: Usage): string[] {
  return Object.entries(price.includedUsage ?? {})
    .filter(([id, limit]) => usage[id as MeterId] > limit)
    .map(([id, limit]) => `${id.replaceAll('_', ' ')} ${Math.round(usage[id as MeterId]).toLocaleString('en-US')} > ${limit.toLocaleString('en-US')}`);
}

function sum(lines: CostLine[]): Range {
  return lines.reduce<Range>(
    (acc, l) => (l.range
      ? { low: acc.low + l.range.low, expected: acc.expected + l.range.expected, high: acc.high + l.range.high }
      : acc),
    { low: 0, expected: 0, high: 0 },
  );
}

const unpricedLine = (label: string): CostLine => ({
  label, category: 'optional', lineClass: 'unpriced', unit: 'n/a',
  quantityAssumption: 'Not estimated', range: null, rateSource: null,
  confidence: 'unverified', priceIsAssumption: true, warnings: [],
});

export function estimate(
  input: EstimateInput, registry: PricingRegistry, runs: CalibrationRun[], today: string,
): CostPlan {
  const model = registry.get(input.buildModel);
  const months = horizonMonths[input.horizon];
  const assumed = (id: string) => registry.isAssumption(id, today);
  const a = input.assumptions ?? {};
  const loopOpts: LoopOptions = { caching: a.caching ?? true, onDate: a.buildDate ?? today };
  const buildOpts: BuildOptions = { ...loopOpts, retryRate: a.retryRate ?? PRIOR_RETRY_RATE };
  const featureLines = input.features.map((f) =>
    buildLine(f, model, runs, input.probes?.[f.name], assumed(model.id), buildOpts));

  let relay: RelayPlan | undefined;
  let buildLines = featureLines;
  if (input.relay) {
    const models: Record<Phase, PriceEntry> = {
      spec: registry.get(input.relay.spec),
      architect: registry.get(input.relay.architect),
      build: model,
      review: registry.get(input.relay.review),
    };
    const line = (phase: Exclude<Phase, 'build'>) =>
      phaseLine(phase, models[phase], input.features.length, assumed(models[phase].id), loopOpts);
    const spec = line('spec');
    const architect = line('architect');
    const review = line('review');
    buildLines = [spec, architect, ...featureLines, review];
    const legs = handoffs(input.features, models, loopOpts);
    relay = {
      phases: PHASES.map((phase) => ({
        phase,
        model: models[phase].id,
        provider: models[phase].provider,
        range: sum(buildLines.filter((l) => l.phase === phase)),
      })),
      handoffs: legs,
      handoffSavings: legs.reduce((t, h) => t + h.saved, 0),
    };
  }
  const traffic = months > 0 ? input.traffic : undefined;

  const paths = (['free', 'paid'] as const).map((path): PathPlan => {
    const ids = PATHS[path];
    const host = registry.get(ids.host);
    const opLines = months === 0
      ? []
      : [ids.host, ids.database, ids.git].map((id) =>
        subscriptionLine(registry.get(id), months, input.commercialUse, assumed(id)));
    const ineligibleReasons = input.commercialUse
      ? [ids.host, ids.database, ids.git]
        .map((id) => registry.get(id))
        .filter((p) => p.commercialUse === 'prohibited')
        .map((p) => `${p.provider} ${p.plan}: ${p.commercialNote ?? 'commercial use prohibited'}`)
      : [];
    const unpriced = (input.unpricedItems ?? []).map(unpricedLine);

    if (traffic) {
      const expectedUsage = monthlyUsage(traffic, 1);
      const over = exceeded(host, expectedUsage);
      if (over.length) ineligibleReasons.push(`${host.provider} ${host.plan}: expected traffic exceeds the monthly guideline (${over.join('; ')})`);
      const overHigh = exceeded(host, monthlyUsage(traffic, TRAFFIC_BAND.high));
      if (!over.length && overHigh.length) {
        opLines[0]!.warnings.push(`At ${TRAFFIC_BAND.high}x expected traffic: ${overHigh.join('; ')}`);
      }
      if (host.meters?.length) {
        const at = (scale: number) => overage(host, monthlyUsage(traffic, scale)) * months;
        opLines.push({
          label: `${host.provider} ${host.plan} usage beyond included credit`,
          category: 'usage_based',
          lineClass: 'conditional',
          unit: 'month',
          quantityAssumption:
            `${trafficAssumption(traffic)}; low/high at ${TRAFFIC_BAND.low}x/${TRAFFIC_BAND.high}x traffic`,
          range: { low: at(TRAFFIC_BAND.low), expected: at(1), high: at(TRAFFIC_BAND.high) },
          rateSource: host.id,
          confidence: host.meters.some((m) => m.startingAt) ? 'medium' : host.confidence,
          priceIsAssumption: assumed(host.id),
          warnings: host.meters.some((m) => m.startingAt)
            ? ['Active CPU and memory are "starting at" prices; some regions cost more']
            : [],
        });
        if (!host.meters.some((m) => m.id === 'fast_data_transfer')) {
          unpriced.push(unpricedLine(`${host.provider} ${host.plan} data transfer (no per-GB price published)`));
        }
      }
    }

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

  const types = new Set(input.features.map((f) => f.type));
  const relevant = runs.filter((r) => types.has(r.featureType));
  return {
    horizon: input.horizon,
    assumptions: [
      ...(input.relay
        ? [`Relay: ${PHASES.map((p) => `${PHASE_LABEL[p].toLowerCase()} on ${relay!.phases.find((x) => x.phase === p)!.model.split('/')[1]}`).join(', ')}`]
        : [`Build model: ${model.product}`]),
      ...(a.retryRate !== undefined ? [`Retry rate: ${a.retryRate} extra attempts per feature`] : []),
      ...(a.caching === false ? ['Prompt caching: off'] : []),
      ...(a.buildDate && a.buildDate !== today ? [`Build date: ${a.buildDate}`] : []),
      `Commercial use: ${input.commercialUse ? 'yes' : 'no'}`,
      `Horizon: ${input.horizon} (${months} month(s) of hosting)`,
      ...(traffic ? [`Traffic: ${trafficAssumption(traffic)}`] : []),
    ],
    calibration: {
      runs: relevant.length,
      calibrated: input.features.every(
        (f) => runs.filter((r) => r.featureType === f.type).length >= MIN_CALIBRATION_RUNS,
      ),
      coverage: coverage(relevant),
    },
    paths,
    ...(relay ? { relay } : {}),
    disclosures: DISCLOSURES,
  };
}
