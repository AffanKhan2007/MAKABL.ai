import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimate, MIN_CALIBRATION_RUNS, type CalibrationRun, type EstimateInput } from '../src/estimator/estimator.ts';
import { PricingRegistry } from '../src/registry/pricing.ts';
import { seedPrices } from '../src/registry/seed.ts';

const registry = new PricingRegistry(seedPrices);
const TODAY = '2026-10-24';
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

test('every priced line has low <= expected <= high', () => {
  const plan = estimate(base, registry, [], TODAY);
  for (const path of plan.paths) {
    for (const l of path.lines) {
      assert.ok(l.range, l.label);
      assert.ok(l.range.low <= l.range.expected && l.range.expected <= l.range.high, l.label);
    }
  }
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

test('uncalibrated lines are low confidence; calibrated lines use logged percentiles', () => {
  const uncal = estimate(base, registry, [], TODAY);
  assert.equal(uncal.calibration.calibrated, false);
  assert.ok(uncal.paths[0].lines.filter((l) => l.unit === 'tokens').every((l) => l.confidence === 'low'));

  const runs: CalibrationRun[] = [];
  for (const type of ['auth', 'crud_endpoint', 'page'] as const) {
    for (let i = 0; i < MIN_CALIBRATION_RUNS; i++) {
      runs.push({ featureType: type, inputTokens: 10_000 * (i + 1), outputTokens: 2_000 * (i + 1), attempts: 1 });
    }
  }
  const cal = estimate(base, registry, runs, TODAY);
  assert.equal(cal.calibration.calibrated, true);
  const line = cal.paths[1].lines[0]!;
  assert.equal(line.confidence, 'medium');
  assert.match(line.quantityAssumption, /P10\/P50\/P90/);
});

test('build_only horizon has no hosting lines; 12 months multiplies recurring', () => {
  const b = estimate({ ...base, horizon: 'build_only' }, registry, [], TODAY);
  assert.ok(b.paths[1].lines.every((l) => l.unit === 'tokens'));
  const y = estimate({ ...base, horizon: 'first_12_months' }, registry, [], TODAY);
  const vercel = y.paths[1].lines.find((l) => l.rateSource === 'vercel/pro')!;
  assert.equal(vercel.range!.expected, 12 * 20_000_000);
});

test('unverified seed prices are flagged as assumptions', () => {
  const plan = estimate(base, registry, [], TODAY);
  assert.ok(plan.paths[1].lines.every((l) => l.priceIsAssumption));
});
