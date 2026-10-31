import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeAdapter, priceMessage, type ClaudeCall, type ClaudeMessage, type ClaudeTransport } from '../src/adapters/claude.ts';
import { RunAccumulator } from '../src/calibration/runs.ts';
import { usd } from '../src/domain/types.ts';
import { MemoryEventLog } from '../src/events/event-store.ts';
import { BudgetBlockedError, BudgetGate } from '../src/gate/budget-gate.ts';
import { observedLlmCost, worstCaseLlmCost } from '../src/gate/llm-cost.ts';
import { MemoryGateStore } from '../src/gate/memory-store.ts';
import { PricingRegistry } from '../src/registry/pricing.ts';
import { seedPrices } from '../src/registry/seed.ts';

// No network: a fake transport records what would have been sent. These tests never
// call the Claude API and spend nothing.

const registry = new PricingRegistry(seedPrices);
const opus = registry.get('anthropic/claude-opus-5-5');
const opus48 = registry.get('anthropic/claude-opus-4-8');
const haiku = registry.get('anthropic/claude-haiku-5-5');
const P = 'proj_adapter';

function message(over: Record<string, unknown> = {}): ClaudeMessage {
  return {
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 1_000, output_tokens: 2_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    ...over,
  } as unknown as ClaudeMessage;
}

function fake(reply: ClaudeMessage = message(), promptTokens = 1_000) {
  const sent: unknown[] = [];
  const transport: ClaudeTransport = {
    countTokens: async () => promptTokens,
    send: async (params) => { sent.push(params); return reply; },
  };
  return { transport, sent };
}

async function setup(cap = usd(10), reply?: ClaudeMessage) {
  const gate = new BudgetGate(new MemoryGateStore(new MemoryEventLog()));
  await gate.setBudget(P, { projectCap: cap, monthlyCap: cap });
  const f = fake(reply);
  return { gate, ...f, adapter: new ClaudeAdapter(gate, registry, f.transport) };
}

let n = 0;
const call = (over: Partial<ClaudeCall> = {}): ClaudeCall => ({
  projectId: P, taskId: 't_1', taskCeiling: usd(10), idempotencyKey: `k_${++n}`,
  description: 'build step', model: opus.id, maxTokens: 16_000,
  messages: [{ role: 'user', content: 'Build the items API' }], ...over,
});

test('sends the request with caching, effort and default fallbacks, then books the priced usage', async () => {
  const { adapter, gate, sent } = await setup();
  await adapter.call(call({ effort: 'high', system: 'You build Next.js apps.' }));
  assert.deepEqual(sent[0], {
    model: 'claude-opus-5-5', max_tokens: 16_000,
    messages: [{ role: 'user', content: 'Build the items API' }],
    system: 'You build Next.js apps.',
    output_config: { effort: 'high' },
    cache_control: { type: 'ephemeral', ttl: '5m' },
    fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'],
  });
  const [entry] = await gate.ledgerFor(P);
  assert.equal(entry?.amount, observedLlmCost(opus, { input_tokens: 1_000, output_tokens: 2_000 }));
  assert.equal(entry?.basis, 'usage_observed');
});

test('Haiku 5.5 gets no fallbacks parameter, since it has no fallback', async () => {
  const { adapter, sent } = await setup(usd(10), message({ model: 'claude-haiku-5-5' }));
  await adapter.call(call({ model: haiku.id, cache: 'none' }));
  const params = sent[0] as Record<string, unknown>;
  assert.equal(params.fallbacks, undefined);
  assert.equal(params.betas, undefined);
  assert.equal(params.cache_control, undefined);
});

test('the reservation covers a fallback attempt at Opus 4.8 rates', async () => {
  const { adapter } = await setup();
  const expected = worstCaseLlmCost(opus, 1_000, 16_000, '5m') + worstCaseLlmCost(opus48, 1_000, 16_000, '5m');
  assert.equal(adapter.worstCase(opus, 1_000, 16_000, '5m'), expected);
  assert.equal(adapter.worstCase(haiku, 1_000, 16_000, '5m'), worstCaseLlmCost(haiku, 1_000, 16_000, '5m'));
});

test('a blocked call never reaches the API', async () => {
  const { adapter, sent } = await setup(usd(0.1));
  await assert.rejects(adapter.call(call()), BudgetBlockedError);
  assert.equal(sent.length, 0);
});

test('a resumed step with the same key replays the stored message without resending', async () => {
  const { adapter, gate, sent } = await setup();
  const c = call({ idempotencyKey: 't_1:turn_3' });
  const first = await adapter.call(c);
  const again = await adapter.call(c);
  assert.equal(sent.length, 1);
  assert.deepEqual(again, first);
  assert.equal((await gate.ledgerFor(P)).length, 1);
});

test('a fallback-served response prices each attempt at its own model', () => {
  const msg = message({
    model: 'claude-opus-4-8',
    usage: {
      input_tokens: 500, output_tokens: 800, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
      iterations: [
        { type: 'message', model: 'claude-opus-5-5', input_tokens: 1_000, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: null },
        { type: 'fallback_message', model: 'claude-opus-4-8', input_tokens: 500, output_tokens: 800, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: null },
      ],
    },
  });
  const priced = priceMessage(msg, opus, registry);
  const expected = observedLlmCost(opus, { input_tokens: 1_000, output_tokens: 300 })
    + observedLlmCost(opus48, { input_tokens: 500, output_tokens: 800 });
  assert.equal(priced.cost, expected);
  assert.deepEqual(priced.attempts.map((a) => a.model), [opus.id, opus48.id]);
  assert.equal(priced.basis, 'usage_observed');
});

test('a model missing from the registry is priced at the highest known Claude rates and marked estimated', () => {
  const msg = message({ model: 'claude-future-9' });
  const priced = priceMessage(msg, opus, registry);
  assert.deepEqual(priced.unknownModels, ['claude-future-9']);
  assert.equal(priced.basis, 'estimated');
  assert.equal(priced.cost, observedLlmCost(registry.get('anthropic/claude-fable-5-1'), { input_tokens: 1_000, output_tokens: 2_000 }));
});

test('usage feeds the calibration run for the feature being built', async () => {
  const { adapter } = await setup();
  const run = new RunAccumulator();
  await adapter.call(call({ run }));
  await adapter.call(call({ run }));
  const r = run.finish({ featureType: 'crud_endpoint', attempts: 1, verified: true });
  assert.equal(r.calls, 2);
  assert.equal(r.model, opus.id);
  assert.equal(r.tokens.output, 4_000);
  assert.equal(r.cost, 2 * observedLlmCost(opus, { input_tokens: 1_000, output_tokens: 2_000 }));
});
