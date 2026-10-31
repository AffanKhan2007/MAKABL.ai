import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CalibrationRun, FeatureType } from '../src/calibration/runs.ts';
import { usd } from '../src/domain/types.ts';
import {
  coverage, estimate, loopCost, MIN_CALIBRATION_RUNS, runCostOn, type EstimateInput,
} from '../src/estimator/estimator.ts';
import { observedLlmCost } from '../src/gate/llm-cost.ts';
import { PricingRegistry, ratesOn } from '../src/registry/pricing.ts';
import { seedPrices } from '../src/registry/seed.ts';

const registry = new PricingRegistry(seedPrices);
const opus = registry.get('anthropic/claude-opus-5-5');
const sonnet = registry.get('anthropic/claude-sonnet-5-5');
const TODAY = '2026-10-27';
const base: EstimateInput = {
  features: [
    { type: 'auth', name: 'Sign in' },
    { type: 'crud_endpoint', name: 'Items API' },
    { type: 'page', name: 'Dashboard' },
  ],
  commercialUse: true,
  buildModel: 'anthropic/claude-opus-5-5',
  horizon: 'first_month',
  unpricedItems: ['Custom domain'],
};

/** A logged Opus run whose cost is all output tokens, so repricing is easy to check. */
function run(featureType: FeatureType, cost: number, extra: Partial<CalibrationRun> = {}): CalibrationRun {
  const outputTokens = Math.round((cost / usd(20)) * 1_000_000);
  return {
    featureType, model: opus.id, calls: 1, attempts: 1, verified: true,
    tokens: { input: 0, output: outputTokens, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 },
    cost, ...extra,
  };
}
const many = (type: FeatureType, costs: number[], extra: (i: number) => Partial<CalibrationRun> = () => ({})) =>
  costs.map((c, i) => run(type, c, extra(i)));
const tenCosts = Array.from({ length: MIN_CALIBRATION_RUNS }, (_, i) => usd(0.1 * (i + 1)));

test('every priced line has low <= expected <= high', () => {
  const plan = estimate({ ...base, traffic: { monthlyVisitors: 5_000 } }, registry, [], TODAY);
  for (const path of plan.paths) {
    for (const l of path.lines) {
      assert.ok(l.range, l.label);
      assert.ok(l.range.low <= l.range.expected && l.range.expected <= l.range.high, l.label);
    }
  }
});

test('the prior models a cached agent loop, turn by turn', () => {
  const p = { turns: 3, baseContext: 1_000, growthPerTurn: 500, outputPerTurn: 200 };
  // Turn 0 writes 1000; turn 1 reads 1000, writes 500; turn 2 reads 1500, writes 500.
  const expected = [
    { input_tokens: 0, output_tokens: 200, cache_creation_input_tokens: 1_000, cache_creation: { ephemeral_5m_input_tokens: 1_000 } },
    { input_tokens: 0, output_tokens: 200, cache_read_input_tokens: 1_000, cache_creation_input_tokens: 500, cache_creation: { ephemeral_5m_input_tokens: 500 } },
    { input_tokens: 0, output_tokens: 200, cache_read_input_tokens: 1_500, cache_creation_input_tokens: 500, cache_creation: { ephemeral_5m_input_tokens: 500 } },
  ].reduce((s, u) => s + observedLlmCost(opus, u), 0);
  assert.equal(loopCost(opus, p), expected);
});

test('caching makes the prior far cheaper than resending the context uncached', () => {
  const p = { turns: 12, baseContext: 10_000, growthPerTurn: 2_000, outputPerTurn: 2_500 };
  let uncached = 0;
  for (let i = 0; i < p.turns; i++) {
    uncached += observedLlmCost(opus, { input_tokens: p.baseContext + i * p.growthPerTurn, output_tokens: p.outputPerTurn });
  }
  assert.ok(loopCost(opus, p) < uncached * 0.75);
});

test('free path is ineligible for commercial work because Vercel Hobby prohibits it', () => {
  const plan = estimate(base, registry, [], TODAY);
  const free = plan.paths.find((p) => p.path === 'free')!;
  assert.equal(free.eligible, false);
  assert.match(free.ineligibleReasons.join(' '), /vercel hobby/);
  const personal = estimate({ ...base, commercialUse: false }, registry, [], TODAY);
  assert.equal(personal.paths.find((p) => p.path === 'free')!.eligible, true);
});

test('unpriced items are reported but not summed', () => {
  const plan = estimate(base, registry, [], TODAY);
  const paid = plan.paths.find((p) => p.path === 'paid')!;
  assert.equal(paid.unpriced.length, 1);
  const summed = paid.lines.reduce((s, l) => s + l.range!.expected, 0);
  assert.equal(paid.totals.expected, summed);
});

test('uncalibrated lines are low confidence; ten logged runs switch to their percentiles', () => {
  const uncal = estimate(base, registry, [], TODAY);
  assert.equal(uncal.calibration.calibrated, false);
  assert.ok(uncal.paths[0].lines.filter((l) => l.unit === 'tokens').every((l) => l.confidence === 'low'));

  const runs = (['auth', 'crud_endpoint', 'page'] as const).flatMap((t) => many(t, tenCosts));
  const cal = estimate(base, registry, runs, TODAY);
  assert.equal(cal.calibration.calibrated, true);
  const line = cal.paths[1].lines[0]!;
  assert.equal(line.confidence, 'medium');
  assert.match(line.quantityAssumption, /P10\/P50\/P90 of 10 logged auth runs/);
  // P10/P50/P90 of $0.10..$1.00
  assert.deepEqual(line.range, { low: usd(0.19), expected: usd(0.55), high: usd(0.91) });
});

test('runs logged on another model are re-priced for the chosen model', () => {
  const r = run('auth', usd(1)); // 50,000 Opus output tokens
  assert.equal(runCostOn(r, opus), usd(1));
  assert.equal(runCostOn(r, sonnet), usd(0.5));
});

test('a probe scales by past full/probe ratios once enough paired runs exist', () => {
  // Every past auth run cost 20x its probe.
  const runs = many('auth', tenCosts, (i) => ({ probeCost: tenCosts[i]! / 20 }));
  const plan = estimate({ ...base, features: [{ type: 'auth', name: 'Sign in' }], probes: { 'Sign in': usd(0.05) } }, registry, runs, TODAY);
  const line = plan.paths[1].lines[0]!;
  assert.match(line.quantityAssumption, /Probe run cost/);
  assert.deepEqual(line.range, { low: usd(1), expected: usd(1), high: usd(1) });
});

test('a probe without enough paired runs is ignored, with a warning', () => {
  const runs = many('auth', tenCosts); // no probes logged
  const plan = estimate({ ...base, features: [{ type: 'auth', name: 'Sign in' }], probes: { 'Sign in': usd(0.05) } }, registry, runs, TODAY);
  const line = plan.paths[1].lines[0]!;
  assert.match(line.quantityAssumption, /logged auth runs/);
  assert.match(line.warnings.join(' '), /Probe not used/);
});

test('coverage says "too few" under ten quoted runs, then reports the hit rate', () => {
  const quoted = (cost: number) => run('auth', cost, { quoted: { low: usd(0.2), high: usd(0.8) } });
  assert.equal(coverage([quoted(usd(0.5))]).share, null);
  const runs = [...tenCosts.map(quoted)];
  // $0.20..$0.80 inclusive: 0.2, 0.3, ... 0.8 = 7 of 10
  assert.deepEqual(coverage(runs), { quotedRuns: 10, inRange: 7, share: 0.7 });
});

test('traffic within the Pro credit adds no usage charge', () => {
  const plan = estimate({ ...base, traffic: { monthlyVisitors: 1_000 } }, registry, [], TODAY);
  const usage = plan.paths[1].lines.find((l) => l.label.includes('usage beyond'))!;
  assert.equal(usage.range!.expected, 0);
  assert.ok(plan.paths[1].unpriced.some((u) => /data transfer/.test(u.label)));
});

test('heavy traffic bills Pro usage beyond the $20 credit, from the published meters', () => {
  const traffic = { monthlyVisitors: 1_000_000, pagesPerVisit: 5, functionCallsPerPage: 2, cpuMsPerCall: 100, wallMsPerCall: 500, memoryGb: 2 };
  const plan = estimate({ ...base, traffic }, registry, [], TODAY);
  const usage = plan.paths[1].lines.find((l) => l.label.includes('usage beyond'))!;
  // 10M calls: $6 invocations + 277.8 h CPU x $0.128 + 5555.6 GB-h x $0.0106 - $20 credit
  const calls = 10_000_000;
  const charges = 6 + (calls * 0.1 / 3600) * 0.128 + (calls * 0.5 * 2 / 3600) * 0.0106;
  assert.equal(usage.range!.expected, usd(charges - 20));
  assert.ok(usage.range!.high > usage.range!.expected);
});

test('traffic over the Hobby guideline makes the free path ineligible even for personal use', () => {
  const plan = estimate({ ...base, commercialUse: false, traffic: { monthlyVisitors: 500_000 } }, registry, [], TODAY);
  const free = plan.paths.find((p) => p.path === 'free')!;
  assert.equal(free.eligible, false);
  assert.match(free.ineligibleReasons.join(' '), /function invocations/);
});

test('build_only horizon has no hosting lines; 12 months multiplies recurring', () => {
  const b = estimate({ ...base, horizon: 'build_only', traffic: { monthlyVisitors: 1_000 } }, registry, [], TODAY);
  assert.ok(b.paths[1].lines.every((l) => l.unit === 'tokens'));
  const y = estimate({ ...base, horizon: 'first_12_months' }, registry, [], TODAY);
  const vercel = y.paths[1].lines.find((l) => l.rateSource === 'vercel/pro')!;
  assert.equal(vercel.range!.expected, 12 * 20_000_000);
});

test('verified prices are trusted until their revalidation date, then become assumptions', () => {
  const fresh = estimate(base, registry, [], TODAY);
  assert.ok(fresh.paths[1].lines.every((l) => !l.priceIsAssumption));
  const stale = estimate(base, registry, [], '2027-02-01');
  assert.ok(stale.paths[1].lines.every((l) => l.priceIsAssumption));
});

const RELAY = {
  spec: 'google/gemini-3.1-flash-lite', architect: 'openai/gpt-6.1-sol', review: 'anthropic/claude-haiku-5-5',
};

test('a relay plan prices each phase on its own model and adds the phases to both paths', () => {
  const plain = estimate(base, registry, [], TODAY);
  const relay = estimate({ ...base, relay: RELAY }, registry, [], TODAY);
  assert.equal(plain.relay, undefined);
  assert.deepEqual(relay.relay!.phases.map((p) => p.phase), ['spec', 'architect', 'build', 'review']);
  assert.deepEqual(relay.relay!.phases.map((p) => p.provider), ['google', 'openai', 'anthropic', 'anthropic']);
  const phaseTotal = relay.relay!.phases.reduce((t, p) => t + p.range.expected, 0);
  const llmLines = relay.paths[1].lines.filter((l) => l.phase);
  assert.equal(llmLines.reduce((t, l) => t + l.range!.expected, 0), phaseTotal);
  // The build phase is unchanged by adding the relay around it.
  const build = relay.relay!.phases.find((p) => p.phase === 'build')!;
  assert.equal(build.range.expected, plain.paths[1].lines.filter((l) => l.phase === 'build')
    .reduce((t, l) => t + l.range!.expected, 0));
  assert.ok(relay.paths[1].totals.expected > plain.paths[1].totals.expected);
});

test('handoff briefs save tokens, and cross-vendor handoffs are flagged', () => {
  const plan = estimate({ ...base, relay: RELAY }, registry, [], TODAY).relay!;
  assert.equal(plan.handoffs.length, 3);
  assert.ok(plan.handoffs.every((h) => h.saved > 0 && h.transcriptTokens > h.briefTokens));
  assert.deepEqual(plan.handoffs.map((h) => h.crossVendor), [true, true, false]);
  assert.equal(plan.handoffSavings, plan.handoffs.reduce((t, h) => t + h.saved, 0));
});

test('turning caching off raises the build estimate and the value of a brief', () => {
  const on = estimate({ ...base, relay: RELAY }, registry, [], TODAY);
  const off = estimate({ ...base, relay: RELAY, assumptions: { caching: false } }, registry, [], TODAY);
  assert.ok(off.paths[1].totals.expected > on.paths[1].totals.expected);
  assert.ok(off.relay!.handoffSavings > on.relay!.handoffSavings);
  assert.ok(off.assumptions.includes('Prompt caching: off'));
});

test('the retry rate scales the expected build cost of an uncalibrated feature', () => {
  const at = (retryRate: number) => estimate({ ...base, assumptions: { retryRate } }, registry, [], TODAY)
    .paths[1].lines.find((l) => l.label === 'Build: Sign in')!.range!.expected;
  assert.equal(at(1), Math.round((at(0) * 2)));
});

test('announced price changes apply from their date', () => {
  const argon = registry.get('google/gemini-4-argon');
  assert.equal(ratesOn(argon, '2026-11-30').inputPerMTok, usd(2));
  assert.equal(ratesOn(argon, '2026-12-01').inputPerMTok, usd(4));
  const relay = { ...RELAY, architect: 'google/gemini-4-argon' };
  const cost = (buildDate: string) => estimate({ ...base, relay, assumptions: { buildDate } }, registry, [], TODAY)
    .relay!.phases.find((p) => p.phase === 'architect')!.range.expected;
  assert.ok(Math.abs(cost('2026-12-15') - 2 * cost('2026-11-15')) <= 2);
});

test('measured phase usage replaces the prior, and the estimate says it is measured', async () => {
  const { aggregateMeasured } = await import('../src/estimator/measured.ts');
  const measured = aggregateMeasured([
    { phase: 'spec', tokens: { input: 200, output: 360 } },                       // an older run: one call
    { phase: 'spec', usage: { input: 220, output: 400, calls: 1 } },
    { phase: 'review', usage: { input: 6_000, output: 600, calls: 3 } },          // three features reviewed
    { phase: 'build', usage: { input: 99_999, output: 99_999, calls: 9 } },        // not a relay phase here: ignored
    { phase: 'architect', usage: { input: 0, output: 0, calls: 0 } },              // nothing recorded: ignored
  ]);
  assert.deepEqual(measured.spec, { inputPerCall: 210, outputPerCall: 380, calls: 2, runs: 2 });
  assert.deepEqual(measured.review, { inputPerCall: 2_000, outputPerCall: 200, calls: 3, runs: 1 });
  assert.equal(measured.architect, undefined);

  const base2 = { ...base, relay: RELAY };
  const withPrior = estimate(base2, registry, [], TODAY);
  const withData = estimate({ ...base2, measured }, registry, [], TODAY);
  const line = (p: typeof withData) => p.paths[1].lines.find((l) => l.phase === 'spec')!;
  assert.match(line(withData).quantityAssumption, /Measured: 2 real call\(s\) over 2 run\(s\) averaged 210 tokens in and 380 out/);
  assert.match(line(withPrior).quantityAssumption, /^Prior:/);
  assert.notEqual(line(withData).range!.expected, line(withPrior).range!.expected);
});

test('a handoff brief is as large as the phase that wrote it, not a fixed size', () => {
  const plan = estimate({ ...base, relay: RELAY, measured: { spec: { inputPerCall: 500, outputPerCall: 300, calls: 1, runs: 1 } } }, registry, [], TODAY);
  const first = plan.relay!.handoffs.find((h) => h.from === 'spec')!;
  assert.equal(first.briefTokens, 300);
  assert.equal(first.transcriptTokens, 800);
});
