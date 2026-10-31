import type { CalibrationRun } from '../calibration/runs.ts';
import type { Micros } from '../domain/types.ts';
import { tokenRatesFor, type PricingRegistry } from '../registry/pricing.ts';
import {
  estimate, PHASES, PRIOR_RETRY_RATE, type CostPlan, type EstimateInput, type Phase,
} from './estimator.ts';

// Conflicts and shortcomings of a cost plan. Every knob the what-if explorer offers trades
// something away; this names the trade instead of leaving it in the fine print. A conflict
// is two choices that work against each other (client work on a free host). A shortcoming
// is something the estimate itself cannot know (uncalibrated phases, unpublished limits).

export type Severity = 'block' | 'warn' | 'info';

export interface Conflict {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** What to change to resolve it, when there is one. */
  fix?: string;
  phase?: Phase;
}

export interface ConflictContext {
  /** The project's approved budget cap, if any. */
  capMicros?: Micros;
  /** Live builds are on: phases must have a working adapter and key. */
  live?: boolean;
  /** Why a provider cannot run live, or null when it can. */
  liveBlocker?: (provider: string) => string | null;
}

/** Output price under which a model counts as cheap for a build loop. */
const CHEAP_OUTPUT_PER_MTOK = 1_000_000;      // $1 per 1M output tokens, in micros
/** Output price from which a model counts as a flagship. */
const FLAGSHIP_OUTPUT_PER_MTOK = 20_000_000;  // $20
const SOON_DAYS = 60;

const usd = (m: Micros) => `$${(m / 1_000_000).toFixed(2)}`;
const short = (id: string) => id.split('/')[1] ?? id;
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
const ORDER: Record<Severity, number> = { block: 0, warn: 1, info: 2 };

export function findConflicts(
  input: EstimateInput, plan: CostPlan, registry: PricingRegistry, runs: CalibrationRun[], today: string,
  ctx: ConflictContext = {},
): Conflict[] {
  const out: Conflict[] = [];
  const a = input.assumptions ?? {};
  const buildDate = a.buildDate ?? today;
  const modelOf: Record<Phase, string> = {
    build: input.buildModel,
    spec: input.relay?.spec ?? input.buildModel,
    architect: input.relay?.architect ?? input.buildModel,
    review: input.relay?.review ?? input.buildModel,
  };
  const phases: Phase[] = input.relay ? [...PHASES] : ['build'];
  const usedModels = [...new Set(phases.map((p) => modelOf[p]))];
  const [free, paid] = plan.paths;

  // Choices that rule a path out.
  if (!free.eligible) {
    out.push({
      id: 'free-path-blocked',
      severity: paid.eligible ? 'warn' : 'block',
      title: 'Free path is not available for this project',
      detail: free.ineligibleReasons.join(' '),
      fix: input.commercialUse ? 'Budget for the paid path; client work cannot use non-commercial free tiers' : undefined,
    });
  }
  if (!paid.eligible) {
    out.push({ id: 'paid-path-blocked', severity: 'block', title: 'Paid path is not available', detail: paid.ineligibleReasons.join(' ') });
  }

  // The cap against the plan.
  if (ctx.capMicros !== undefined) {
    const llm = sumPhases(plan);
    if (ctx.capMicros < llm.expected) {
      out.push({
        id: 'cap-below-expected', severity: 'warn',
        title: 'Budget cap is below the expected build cost',
        detail: `Cap ${usd(ctx.capMicros)}, expected ${usd(llm.expected)}. The build will pause for approval before it finishes.`,
        fix: `Raise the cap to at least ${usd(llm.expected)}, or move a phase to a cheaper model`,
      });
    } else if (ctx.capMicros < llm.high) {
      out.push({
        id: 'cap-below-high', severity: 'info',
        title: 'A bad run could hit the cap',
        detail: `Cap ${usd(ctx.capMicros)} covers the expected ${usd(llm.expected)} but not the high end ${usd(llm.high)}. The gate pauses rather than overspends.`,
      });
    }
  }

  // Prices that move.
  for (const id of usedModels) {
    const price = registry.get(id);
    for (const change of price.priceChanges ?? []) {
      if (change.from <= today) continue;
      if (change.from <= buildDate) {
        out.push({
          id: `price-change-${id}`, severity: 'warn',
          title: `${short(id)} costs more on the build date`,
          detail: `${change.note ?? `New rates from ${change.from}`}. The plan prices the build on ${buildDate}, so it uses the new rates.`,
          fix: `Build before ${change.from}, or pick another model for that phase`,
        });
      } else if (daysBetween(buildDate, change.from) <= SOON_DAYS) {
        out.push({
          id: `price-change-${id}`, severity: 'info',
          title: `${short(id)} price rises on ${change.from}`,
          detail: `${change.note ?? 'Announced price change'}. This quote holds only if the build and any change requests finish before then.`,
        });
      }
    }
    if (price.lifecycle === 'preview' || price.lifecycle === 'deprecated') {
      out.push({
        id: `lifecycle-${id}`, severity: 'warn',
        title: `${short(id)} is ${price.lifecycle === 'preview' ? 'a preview model' : 'deprecated'}`,
        detail: price.lifecycle === 'preview'
          ? 'Preview models can change behaviour or price, or be withdrawn, with little notice. A rebuild may not match this quote.'
          : 'The vendor is retiring this model. Change requests later may have to move to another model and be re-quoted.',
        fix: 'Pick a generally available model for this phase',
      });
    } else if (price.lifecycle === 'legacy') {
      out.push({
        id: `lifecycle-${id}`, severity: 'info',
        title: `${short(id)} is an older generation`,
        detail: 'Still sold, but a newer model from the same vendor usually costs the same or less for better work.',
      });
    }
    if (price.promotionalUntil) {
      out.push({
        id: `promo-${id}`, severity: 'warn',
        title: `${short(id)} is on a promotional price`,
        detail: `Listed rate runs until at least ${price.promotionalUntil}; the provider has not said what follows.`,
      });
    }
    if (price.freeTier) {
      out.push({
        id: `free-tier-${id}`, severity: 'info',
        title: `${short(id)} free tier is not used in the plan`,
        detail: `${price.freeTier.note}. The plan prices every call at paid rates, so a free-tier build may cost less, or stall on limits we cannot see.`,
      });
    }
  }

  // Model-to-phase fit.
  const buildRates = tokenRatesFor(registry.get(input.buildModel), 0, buildDate);
  const retryRate = a.retryRate ?? PRIOR_RETRY_RATE;
  if (buildRates.outputPerMTok < CHEAP_OUTPUT_PER_MTOK) {
    out.push({
      id: 'cheap-build-model', severity: 'warn', phase: 'build',
      title: `Cheap build model: ${short(input.buildModel)}`,
      detail: `Small models fail verification more often, and every retry is a new paid attempt. The plan assumes ${1 + retryRate} attempts per feature${retryRate <= PRIOR_RETRY_RATE ? ', which may be optimistic for this model' : ''}.`,
      fix: retryRate <= PRIOR_RETRY_RATE ? 'Raise the retry rate to 1 or more, or build on a stronger model' : undefined,
    });
  }
  for (const phase of ['spec', 'review'] as const) {
    if (!input.relay) break;
    const rates = tokenRatesFor(registry.get(modelOf[phase]), 0, buildDate);
    if (rates.outputPerMTok >= FLAGSHIP_OUTPUT_PER_MTOK) {
      out.push({
        id: `flagship-${phase}`, severity: 'info', phase,
        title: `Flagship model on the ${phase} phase`,
        detail: `${short(modelOf[phase])} on a short, single-pass phase. A small model usually does this well for a fraction of the cost.`,
      });
    }
  }

  // Handoffs.
  const cross = plan.relay?.handoffs.filter((h) => h.crossVendor) ?? [];
  if (cross.length) {
    out.push({
      id: 'cross-vendor-handoff', severity: 'info',
      title: `${cross.length} handoff${cross.length > 1 ? 's cross' : ' crosses'} vendors`,
      detail: `${cross.map((h) => `${h.from} → ${h.to}`).join(', ')}: no prompt cache carries over, so the next model reads the brief at full input price, and tool-call formats differ between vendors. Only the brief travels; the full history stays behind its pointer.`,
    });
  }

  // Knobs that make the plan less true.
  if (a.caching === false) {
    const withCache = estimate({ ...input, assumptions: { ...a, caching: true } }, registry, runs, today);
    const extra = sumPhases(plan).expected - sumPhases(withCache).expected;
    out.push({
      id: 'caching-off', severity: 'warn',
      title: 'Prompt caching is off',
      detail: `Every turn resends its whole context. That adds about ${usd(extra)} to the expected build.`,
      fix: 'Turn caching on unless a provider or policy forbids it',
    });
  }
  if (a.retryRate !== undefined && a.retryRate < PRIOR_RETRY_RATE && !plan.calibration.calibrated) {
    out.push({
      id: 'retry-optimistic', severity: 'warn', phase: 'build',
      title: 'Retry rate is below the default with no runs to back it',
      detail: `${a.retryRate} extra attempts per feature is lower than the ${PRIOR_RETRY_RATE} the estimator assumes before it has logged runs.`,
    });
  }

  // What the estimate cannot know.
  if (!plan.calibration.calibrated) {
    out.push({
      id: 'uncalibrated', severity: 'info',
      title: 'Ranges come from priors, not logged runs',
      detail: `${plan.calibration.runs} relevant runs logged. Below 10 runs per feature type the range is deliberately wide and its hit rate is unknown.`,
    });
  }
  if (input.relay) {
    out.push({
      id: 'relay-priors', severity: 'info',
      title: 'Spec, architecture and review are priced from priors',
      detail: 'Only build runs are logged so far. Those phases are short, but their ranges have no history behind them.',
    });
  }
  const stale = paid.lines.filter((l) => l.priceIsAssumption).map((l) => l.label);
  if (stale.length) {
    out.push({
      id: 'stale-prices', severity: 'warn',
      title: 'Some prices need re-checking',
      detail: `${stale.join(', ')}: not verified against the official page since the revalidation date. Confirm before a paid commitment.`,
    });
  }
  if (paid.unpriced.length) {
    out.push({
      id: 'unpriced', severity: 'info',
      title: `${paid.unpriced.length} cost${paid.unpriced.length > 1 ? 's are' : ' is'} not in the totals`,
      detail: paid.unpriced.map((l) => l.label).join('; '),
    });
  }

  // Live builds.
  if (ctx.live && ctx.liveBlocker) {
    for (const phase of phases) {
      const provider = registry.get(modelOf[phase]).provider;
      const reason = ctx.liveBlocker(provider);
      if (reason) {
        out.push({
          id: `live-${phase}`, severity: 'block', phase,
          title: `The ${phase} phase cannot run live on ${short(modelOf[phase])}`,
          detail: reason,
          fix: 'Pick a model whose provider adapter and API key are configured',
        });
      }
    }
  }

  return out.sort((x, y) => ORDER[x.severity] - ORDER[y.severity]);
}

/** Model-usage lines of the paid path (the same on both paths). */
function sumPhases(plan: CostPlan): { expected: Micros; high: Micros } {
  return plan.paths[1].lines
    .filter((l) => l.phase && l.range)
    .reduce((t, l) => ({ expected: t.expected + l.range!.expected, high: t.high + l.range!.high }), { expected: 0, high: 0 });
}

/**
 * The same conflict in everyday words, for Easy mode, or null when it only matters to
 * someone tuning models (vendor handoffs, older generations, free tiers).
 */
export function plainLanguage(c: Conflict): string | null {
  const [kind] = c.id.split('-', 1);
  if (c.id === 'free-path-blocked') return 'Because this is for a business, free hosting plans are not allowed. The plan uses paid hosting instead.';
  if (c.id === 'paid-path-blocked') return 'This plan cannot run as set up. Switch to Pro mode to see why.';
  if (c.id === 'cap-below-expected') return 'Your spending limit is lower than the likely cost. MAKABL will stop and ask you before it spends more.';
  if (c.id === 'cap-below-high') return 'If the build goes badly it could reach your spending limit. It stops and asks rather than overspending.';
  if (c.id === 'cheap-build-model') return 'A smaller, cheaper AI does the building. It makes more mistakes, so the plan allows for retries.';
  if (c.id === 'caching-off') return 'A money-saving setting is switched off, so building costs more.';
  if (c.id === 'uncalibrated') return 'We have not built enough apps like this yet to be precise, so the range is wide on purpose.';
  if (c.id === 'stale-prices') return 'Some prices have not been re-checked recently. Confirm them before you pay for anything.';
  if (c.id === 'unpriced') {
    const items = c.detail.split('; ').map((l) => (/data transfer/i.test(l) ? 'extra traffic charges from the website host' : l));
    return `Not included in the price: ${items.join(', ')}.`;
  }
  if (c.id.startsWith('price-change-')) {
    return c.severity === 'warn'
      ? 'One of the AI services raises its price before your build date, so the estimate uses the higher price.'
      : 'One of the AI services raises its price soon. Building before then keeps this price.';
  }
  if (c.id.startsWith('lifecycle-') && c.severity === 'warn') return 'One of the AI models is a preview or being retired, so its price or behaviour may change.';
  if (kind === 'promo') return 'One of the AI models is on a limited-time price.';
  if (kind === 'live') return 'One of the AI services is not connected on this server yet.';
  return null;
}
