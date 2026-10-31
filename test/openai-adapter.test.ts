import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeAdapter, ProviderLimitError, type ClaudeCall } from '../src/adapters/claude.ts';
import { chatMessages, openAiDirect, openAiEndpointFrom, openAiTransport, openRouter, qwenCloud, qwenEndpointFrom } from '../src/adapters/openai.ts';
import { usd } from '../src/domain/types.ts';
import { MemoryEventLog } from '../src/events/event-store.ts';
import { BudgetGate } from '../src/gate/budget-gate.ts';
import { MemoryGateStore } from '../src/gate/memory-store.ts';
import { PricingRegistry } from '../src/registry/pricing.ts';
import { seedPrices } from '../src/registry/seed.ts';
import { liveModeStatus } from '../src/server/live-mode.ts';

// No network: fetch is replaced per test. Nothing here calls OpenAI or OpenRouter.

const registry = new PricingRegistry(seedPrices);

async function withFetch(status: number, reply: unknown, run: (sent: Array<{ url: string; body: any; auth: string }>) => Promise<void>) {
  const original = globalThis.fetch;
  const sent: Array<{ url: string; body: any; auth: string }> = [];
  globalThis.fetch = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
    sent.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization ?? '' });
    return new Response(typeof reply === 'string' ? reply : JSON.stringify(reply), { status });
  }) as typeof fetch;
  try { await run(sent); } finally { globalThis.fetch = original; }
}

test('Anthropic-style turns become Chat Completions messages, tool calls and tool results included', () => {
  const out = chatMessages({
    system: 'Build it.',
    messages: [
      { role: 'user', content: 'Start' },
      { role: 'assistant', content: [{ type: 'text', text: 'Listing' }, { type: 'tool_use', id: 'call_1', name: 'list_files', input: { path: '.' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'app\nlib' }] },
    ],
  } as never);
  assert.deepEqual(out, [
    { role: 'system', content: 'Build it.' },
    { role: 'user', content: 'Start' },
    { role: 'assistant', content: 'Listing', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'list_files', arguments: '{"path":"."}' } }] },
    { role: 'tool', tool_call_id: 'call_1', content: 'app\nlib' },
  ]);
});

test('a response maps back to the block shape, and the Gate books it at the registry price', async () => {
  const reply = {
    id: 'chatcmpl_1',
    choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'write_file', arguments: '{"path":"a.ts"}' } }] } }],
    usage: { prompt_tokens: 1_000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 400 } },
  };
  await withFetch(200, reply, async (sent) => {
    const gate = new BudgetGate(new MemoryGateStore(new MemoryEventLog()));
    await gate.setBudget('p', { projectCap: usd(5), monthlyCap: usd(5) });
    const adapter = new ClaudeAdapter(gate, registry, openAiTransport(openRouter('or-key')), 'openai');
    const call: ClaudeCall = {
      projectId: 'p', taskId: 'relay:architect', taskCeiling: usd(5), idempotencyKey: 'k1', description: 'arch',
      model: 'openai/gpt-6.1-sol', maxTokens: 2_000, messages: [{ role: 'user', content: 'plan' }],
    };
    const msg = await adapter.call(call);
    assert.equal(sent[0]!.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(sent[0]!.auth, 'Bearer or-key');
    assert.equal(sent[0]!.body.model, 'openai/gpt-6.1-sol');
    assert.equal(sent[0]!.body.max_completion_tokens, 2_000);
    assert.equal(msg.stop_reason, 'tool_use');
    assert.deepEqual(msg.content, [{ type: 'tool_use', id: 'call_9', name: 'write_file', input: { path: 'a.ts' } }]);
    // GPT-6.1 Sol: $2 input, $0.10 cached, $10 output per 1M tokens.
    assert.equal(await gate.spent('p'), Math.ceil((600 * 2 + 400 * 0.1 + 200 * 10)));
  });
});

test('out of credits or quota stops with ProviderLimitError; the Gate books nothing', async () => {
  await withFetch(402, '{"error":{"message":"Insufficient credits"}}', async () => {
    const gate = new BudgetGate(new MemoryGateStore(new MemoryEventLog()));
    await gate.setBudget('p', { projectCap: usd(5), monthlyCap: usd(5) });
    const adapter = new ClaudeAdapter(gate, registry, openAiTransport(openAiDirect('sk-test')), 'openai');
    await assert.rejects(adapter.call({
      projectId: 'p', taskId: 't', taskCeiling: usd(5), idempotencyKey: 'k', description: 'd',
      model: 'openai/gpt-6.1-terra', maxTokens: 100, messages: [{ role: 'user', content: 'x' }],
    }), ProviderLimitError);
    assert.equal(await gate.spent('p'), 0);
  });
});

test('either key enables OpenAI models; OpenAI direct wins when both are set', () => {
  assert.equal(openAiEndpointFrom({})?.label, undefined);
  assert.equal(openAiEndpointFrom({ OPENROUTER_API_KEY: 'a' })?.label, 'OpenRouter');
  assert.equal(openAiEndpointFrom({ OPENROUTER_API_KEY: 'a', OPENAI_API_KEY: 'b' })?.label, 'OpenAI');
  assert.equal(liveModeStatus({ OPENROUTER_API_KEY: 'a', MAKABL_ALLOW_UNSANDBOXED_BUILDS: '1' }, 'openai').available, true);
  assert.match(liveModeStatus({}, 'openai').missing[0]!, /OPENAI_API_KEY or OPENROUTER_API_KEY/);
});

test('Qwen Cloud: Singapore endpoint, max_tokens, thinking off, booked at the registry price', async () => {
  const reply = {
    id: 'chatcmpl_q', choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
    usage: { prompt_tokens: 2_000, completion_tokens: 500 },
  };
  await withFetch(200, reply, async (sent) => {
    const gate = new BudgetGate(new MemoryGateStore(new MemoryEventLog()));
    await gate.setBudget('p', { projectCap: usd(5), monthlyCap: usd(5) });
    const adapter = new ClaudeAdapter(gate, registry, openAiTransport(qwenCloud('qw-key')), 'qwen');
    const msg = await adapter.call({
      projectId: 'p', taskId: 'relay:spec', taskCeiling: usd(5), idempotencyKey: 'kq', description: 'spec',
      model: 'qwen/qwen3.8-flash', maxTokens: 1_000, messages: [{ role: 'user', content: 'spec' }],
    });
    assert.equal(sent[0]!.url, 'https://ap-southeast-1.maas.qwencloudapi.com/compatible-mode/v1/chat/completions');
    assert.equal(sent[0]!.auth, 'Bearer qw-key');
    assert.equal(sent[0]!.body.model, 'qwen3.8-flash');
    assert.equal(sent[0]!.body.max_tokens, 1_000);
    assert.equal(sent[0]!.body.max_completion_tokens, undefined);
    assert.equal(sent[0]!.body.enable_thinking, false);
    assert.equal(msg.stop_reason, 'end_turn');
    // Qwen3.8 Flash: $0.15 input, $0.47 output per 1M tokens.
    assert.equal(await gate.spent('p'), Math.ceil(2_000 * 0.15 + 500 * 0.47));
  });
});

test('DASHSCOPE_API_KEY enables Qwen models', () => {
  assert.equal(qwenEndpointFrom({}), null);
  assert.equal(qwenEndpointFrom({ DASHSCOPE_API_KEY: 'k' })?.label, 'Qwen Cloud');
  assert.equal(liveModeStatus({ DASHSCOPE_API_KEY: 'k', MAKABL_ALLOW_UNSANDBOXED_BUILDS: '1' }, 'qwen').available, true);
  assert.match(liveModeStatus({}, 'qwen').missing[0]!, /DASHSCOPE_API_KEY/);
});
