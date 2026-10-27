import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usd } from '../src/domain/types.ts';
import { observedLlmCost, worstCaseLlmCost } from '../src/gate/llm-cost.ts';
import { PricingRegistry, tokenRatesFor } from '../src/registry/pricing.ts';
import { seedPrices } from '../src/registry/seed.ts';

const registry = new PricingRegistry(seedPrices);
const opus = registry.get('anthropic/claude-opus-5-5');
const haiku = registry.get('anthropic/claude-haiku-5-5');
const M = 1_000_000;

test('plain input and output use base rates', () => {
  assert.equal(observedLlmCost(opus, { input_tokens: M, output_tokens: M }), usd(24));
});

test('cache reads on Opus 5.5 cost 0.05x base input', () => {
  assert.equal(observedLlmCost(opus, { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: M }), usd(0.2));
});

test('cache writes are priced by lifetime from the usage breakdown', () => {
  const cost = observedLlmCost(opus, {
    input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 2 * M,
    cache_creation: { ephemeral_5m_input_tokens: M, ephemeral_1h_input_tokens: M },
  });
  assert.equal(cost, usd(5) + usd(8));
});

test('writes without a breakdown are priced at the 1h rate, never lower', () => {
  const cost = observedLlmCost(opus, { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: M });
  assert.equal(cost, usd(8));
});

test('Haiku 5.5 switches every token to long-prompt rates over 100K input, cache included', () => {
  const short = observedLlmCost(haiku, { input_tokens: 100_000, output_tokens: 0 });
  assert.equal(short, usd(0.01));
  // 90K fresh + 20K cache reads = 110K prompt: the whole request moves tiers.
  const long = observedLlmCost(haiku, { input_tokens: 90_000, output_tokens: 1_000, cache_read_input_tokens: 20_000 });
  const expected = Math.ceil((90_000 * usd(0.5) + 20_000 * usd(0.05) + 1_000 * usd(2.5)) / M);
  assert.equal(long, expected);
  assert.equal(tokenRatesFor(haiku, 100_001).inputPerMTok, usd(0.5));
});

test('worst case covers any usage within the prompt and max_tokens bounds', () => {
  const prompt = 60_000;
  const maxOut = 16_000;
  const worst = worstCaseLlmCost(opus, prompt, maxOut, '1h');
  const scenarios = [
    { input_tokens: prompt, output_tokens: maxOut },
    { input_tokens: 0, output_tokens: maxOut, cache_creation_input_tokens: prompt },
    { input_tokens: 10_000, output_tokens: maxOut, cache_read_input_tokens: 50_000 },
    { input_tokens: 0, output_tokens: maxOut, cache_creation_input_tokens: prompt,
      cache_creation: { ephemeral_5m_input_tokens: prompt, ephemeral_1h_input_tokens: 0 } },
  ];
  for (const usage of scenarios) assert.ok(observedLlmCost(opus, usage) <= worst, JSON.stringify(usage));
});

test('a cache-writing request reserves more than a plain one', () => {
  const plain = worstCaseLlmCost(opus, 60_000, 16_000);
  assert.ok(worstCaseLlmCost(opus, 60_000, 16_000, '5m') > plain);
  assert.ok(worstCaseLlmCost(opus, 60_000, 16_000, '1h') > worstCaseLlmCost(opus, 60_000, 16_000, '5m'));
});

test('every seeded price is verified and has a revalidation date', () => {
  for (const p of seedPrices) {
    assert.ok(p.verifiedAt, p.id);
    assert.ok(p.revalidateAfter && p.revalidateAfter > p.verifiedAt!, p.id);
    assert.equal(registry.isAssumption(p.id, '2026-10-27'), false, p.id);
    assert.equal(registry.isAssumption(p.id, '2027-02-01'), true, p.id);
  }
});
