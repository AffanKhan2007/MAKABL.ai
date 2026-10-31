import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usd } from '../src/domain/types.ts';
import { findConflicts } from '../src/estimator/conflicts.ts';
import { estimate, type EstimateInput } from '../src/estimator/estimator.ts';
import { PricingRegistry } from '../src/registry/pricing.ts';
import { seedPrices } from '../src/registry/seed.ts';

const registry = new PricingRegistry(seedPrices);
const TODAY = '2026-10-31';
const base: EstimateInput = {
  features: [{ type: 'auth', name: 'Sign in' }, { type: 'page', name: 'Dashboard' }],
  commercialUse: true,
  buildModel: 'anthropic/claude-opus-5-5',
  horizon: 'first_month',
};
const RELAY = { spec: 'google/gemini-3.1-flash-lite', architect: 'openai/gpt-6.1-sol', review: 'anthropic/claude-haiku-5-5' };

const ids = (input: EstimateInput, ctx = {}) =>
  findConflicts(input, estimate(input, registry, [], TODAY), registry, [], TODAY, ctx).map((c) => c.id);

test('client work flags the blocked free path, and blockers sort first', () => {
  const input = { ...base, relay: RELAY };
  const live = findConflicts(input, estimate(input, registry, [], TODAY), registry, [], TODAY, {
    live: true, liveBlocker: (p) => (p === 'anthropic' ? null : `No ${p} key`),
  });
  assert.ok(live.some((c) => c.id === 'free-path-blocked'));
  assert.deepEqual(live.filter((c) => c.severity === 'block').map((c) => c.id), ['live-spec', 'live-architect']);
  assert.equal(live[0]!.severity, 'block');
  assert.ok(!ids({ ...base, commercialUse: false }).includes('free-path-blocked'));
});

test('a price change before the build date is a warning; one soon after is a note', () => {
  const argon = { ...base, relay: { ...RELAY, architect: 'google/gemini-4-argon' } };
  const late = findConflicts(
    { ...argon, assumptions: { buildDate: '2026-12-10' } },
    estimate({ ...argon, assumptions: { buildDate: '2026-12-10' } }, registry, [], TODAY), registry, [], TODAY,
  ).find((c) => c.id === 'price-change-google/gemini-4-argon')!;
  assert.equal(late.severity, 'warn');
  const soon = findConflicts(argon, estimate(argon, registry, [], TODAY), registry, [], TODAY)
    .find((c) => c.id === 'price-change-google/gemini-4-argon')!;
  assert.equal(soon.severity, 'info');
});

test('model-to-phase fit: cheap build model, flagship on a light phase, free tiers', () => {
  const found = ids({ ...base, buildModel: 'openai/gpt-6-luna', relay: { ...RELAY, review: 'anthropic/claude-opus-5-5' } });
  assert.ok(found.includes('cheap-build-model'));
  assert.ok(found.includes('flagship-review'));
  assert.ok(found.includes('free-tier-google/gemini-3.1-flash-lite'));
  assert.ok(found.includes('cross-vendor-handoff'));
  assert.ok(!ids(base).includes('cross-vendor-handoff'));
});

test('turning caching off says what it costs', () => {
  const input = { ...base, assumptions: { caching: false } };
  const c = findConflicts(input, estimate(input, registry, [], TODAY), registry, [], TODAY)
    .find((x) => x.id === 'caching-off')!;
  assert.match(c.detail, /adds about \$\d+\.\d\d/);
});

test('the cap is checked against expected and high build cost', () => {
  assert.ok(ids(base, { capMicros: usd(0.01) }).includes('cap-below-expected'));
  assert.ok(ids(base, { capMicros: usd(1_000) }).every((id) => !id.startsWith('cap-')));
});

test('stale prices and an optimistic retry rate are called out', () => {
  const input = { ...base, assumptions: { retryRate: 0 } };
  const stale = findConflicts(input, estimate(input, registry, [], '2027-03-01'), registry, [], '2027-03-01').map((c) => c.id);
  assert.ok(stale.includes('stale-prices'));
  assert.ok(stale.includes('retry-optimistic'));
});

test('every catalog model is priced, and preview or deprecated models are flagged', async () => {
  const { MODEL_CATALOG } = await import('../src/registry/models.ts');
  assert.ok(MODEL_CATALOG.length > 50);
  for (const m of MODEL_CATALOG) assert.equal(registry.get(m.id).category, 'llm');
  assert.ok(ids({ ...base, buildModel: 'google/gemini-3.1-pro-preview' }).includes('lifecycle-google/gemini-3.1-pro-preview'));
  assert.ok(ids({ ...base, buildModel: 'openai/gpt-5.6-sol' }).includes('promo-openai/gpt-5.6-sol'));
});
