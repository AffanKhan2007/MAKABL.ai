import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeEndpointFor, openAiTransport } from '../src/adapters/openai.ts';
import { MODEL_CATALOG } from '../src/registry/models.ts';
import { liveModeStatus } from '../src/server/live-mode.ts';
import { registry } from '../src/server/plan.ts';

test('each free provider has its endpoint, model ids and key', () => {
  const env = { GROQ_API_KEY: 'g', MISTRAL_API_KEY: 'm', OPENROUTER_API_KEY: 'o' };
  assert.equal(freeEndpointFor('groq', env)?.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(freeEndpointFor('mistral', env)?.url, 'https://api.mistral.ai/v1/chat/completions');
  assert.equal(freeEndpointFor('openrouter', env)?.modelId('gpt-oss-120b-free'), 'openai/gpt-oss-120b:free');
  assert.equal(freeEndpointFor('groq', {}), null);
  assert.equal(liveModeStatus({ ...env, MAKABL_ALLOW_UNSANDBOXED_BUILDS: '1' }, 'mistral').available, true);
  assert.equal(liveModeStatus({ MAKABL_ALLOW_UNSANDBOXED_BUILDS: '1' }, 'groq').available, false);
});

test('the new models are in the catalog and priced, marked unverified', () => {
  for (const id of ['groq/llama-3.3-70b-versatile', 'openrouter/gpt-oss-120b-free', 'mistral/mistral-small-latest']) {
    assert.ok(MODEL_CATALOG.some((m) => m.id === id), id);
    assert.equal(registry.get(id).confidence, 'unverified');
  }
  assert.equal(registry.get('openrouter/gpt-oss-120b-free').rates.outputPerMTok, 0);
});

test('Mistral and OpenRouter get max_tokens; the endpoint model id is sent', async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({
      id: 'x', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    }), { status: 200 });
  }) as unknown as typeof fetch;
  try {
    const params = { model: 'gpt-oss-120b-free', max_tokens: 50, messages: [{ role: 'user' as const, content: 'hi' }] };
    const msg = await openAiTransport(freeEndpointFor('openrouter', { OPENROUTER_API_KEY: 'o' })!).send(params);
    await openAiTransport(freeEndpointFor('groq', { GROQ_API_KEY: 'g' })!).send({ ...params, model: 'llama-3.3-70b-versatile' });
    assert.equal(msg.stop_reason, 'end_turn');
    assert.deepEqual([bodies[0]!.model, bodies[0]!.max_tokens], ['openai/gpt-oss-120b:free', 50]);
    assert.deepEqual([bodies[1]!.model, bodies[1]!.max_completion_tokens], ['llama-3.3-70b-versatile', 50]);
  } finally {
    globalThis.fetch = real;
  }
});
