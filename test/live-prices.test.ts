import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openRouterId, parseLivePrices, priceDrift } from '../src/registry/live-prices.ts';
import { PricingRegistry } from '../src/registry/pricing.ts';
import { seedPrices } from '../src/registry/seed.ts';

const registry = new PricingRegistry(seedPrices);
const NOW = new Date('2026-10-31T17:00:00Z');

const list = (rows: Array<[string, string, string]>) => ({ data: rows.map(([id, prompt, completion]) => ({ id, pricing: { prompt, completion } })) });

test('registry ids map to OpenRouter ids: Claude versions use dots, others are unchanged', () => {
  assert.equal(openRouterId({ provider: 'anthropic', product: 'claude-opus-5-5' }), 'anthropic/claude-opus-5.5');
  assert.equal(openRouterId({ provider: 'anthropic', product: 'claude-sonnet-5' }), 'anthropic/claude-sonnet-5');
  assert.equal(openRouterId({ provider: 'openai', product: 'gpt-6.1-sol' }), 'openai/gpt-6.1-sol');
  assert.equal(openRouterId({ provider: 'google', product: 'gemini-3.5-flash-lite' }), 'google/gemini-3.5-flash-lite');
});

test('live prices are matched by exact id and converted to micros per 1M tokens', () => {
  const live = parseLivePrices(list([
    ['anthropic/claude-opus-5.5', '0.000004', '0.00002'],
    ['openai/gpt-6.1-sol-pro', '0.000002', '0.00001'], // a different model: must not match gpt-6.1-sol
  ]), registry, NOW);
  assert.equal(live.fetchedAt, NOW.toISOString());
  assert.equal(live.byRegistryId.get('anthropic/claude-opus-5-5')?.inputPerMTok, 4_000_000);
  assert.equal(live.byRegistryId.get('anthropic/claude-opus-5-5')?.outputPerMTok, 20_000_000);
  assert.equal(live.byRegistryId.has('openai/gpt-6.1-sol'), false);
  assert.equal(live.found, 1);
  assert.ok(live.asked > 50);
});

test('a price that moved is reported with how far; one that matches is not', () => {
  const live = parseLivePrices(list([
    ['anthropic/claude-opus-5.5', '0.000004', '0.00002'],         // matches
    ['google/gemini-3.8-flash', '0.000000825', '0.000004125'],    // 10% above the registry
  ]), registry, NOW);
  const drift = priceDrift(live, registry, '2026-10-31');
  assert.deepEqual(drift.map((d) => d.id), ['google/gemini-3.8-flash']);
  assert.ok(Math.abs(drift[0]!.input - 0.1) < 0.001);
});

test('an announced price change is compared against the price in force that day', () => {
  // Gemini 4 Argon doubles on 1 Dec: a live list showing the new price is only drift before then.
  const live = parseLivePrices(list([['google/gemini-4-argon', '0.000004', '0.00002']]), registry, NOW);
  assert.equal(priceDrift(live, registry, '2026-11-15').length, 1);
  assert.equal(priceDrift(live, registry, '2026-12-05').length, 0);
});
