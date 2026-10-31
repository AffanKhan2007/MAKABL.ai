import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geminiTransport } from '../src/adapters/gemini.ts';

// No network: fetch is replaced for each test and restored afterwards.

function withFetch(reply: unknown, run: (bodies: Array<{ url: string; body: any }>) => Promise<void>) {
  const original = globalThis.fetch;
  const bodies: Array<{ url: string; body: any }> = [];
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    bodies.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as typeof fetch;
  return run(bodies).finally(() => { globalThis.fetch = original; });
}

const params = {
  model: 'gemini-3.5-flash-lite',
  system: 'You are the spec phase.',
  messages: [{ role: 'user', content: 'Describe it.' }],
  tools: [{ name: 'write_file', description: 'Write', input_schema: { type: 'object', properties: {}, additionalProperties: false } }],
} as never;

test('countTokens wraps a system prompt and tools in a generateContentRequest', async () => {
  await withFetch({ totalTokens: 42 }, async (bodies) => {
    assert.equal(await geminiTransport('k').countTokens(params), 42);
    const { url, body } = bodies[0]!;
    assert.match(url, /gemini-3\.5-flash-lite:countTokens$/);
    assert.equal(body.systemInstruction, undefined);
    assert.equal(body.generateContentRequest.model, 'models/gemini-3.5-flash-lite');
    assert.deepEqual(body.generateContentRequest.systemInstruction, { parts: [{ text: 'You are the spec phase.' }] });
    assert.equal(body.generateContentRequest.tools[0].functionDeclarations[0].name, 'write_file');
    assert.equal(body.generateContentRequest.tools[0].functionDeclarations[0].parameters.additionalProperties, undefined);
  });
});

test('send maps text, function calls and usage into the message shape the build loop reads', async () => {
  const reply = {
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'ok' }, { functionCall: { name: 'write_file', args: { path: 'a.ts' } } }] } }],
    usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 20, thoughtsTokenCount: 5 },
  };
  await withFetch(reply, async (bodies) => {
    const msg = await geminiTransport('k').send({ ...(params as object), max_tokens: 500 } as never);
    assert.equal(bodies[0]!.body.systemInstruction.parts[0].text, 'You are the spec phase.');
    assert.equal(msg.stop_reason, 'tool_use');
    assert.deepEqual(msg.content.map((b) => b.type), ['text', 'tool_use']);
    assert.deepEqual(msg.usage, { input_tokens: 60, output_tokens: 25, cache_read_input_tokens: 40 });
  });
});

test('reads how long Gemini asks to wait, from RetryInfo or the message text', async () => {
  const { retryAfterSeconds } = await import('../src/adapters/gemini.ts');
  assert.equal(retryAfterSeconds('{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay": "37s"}'), 37);
  assert.equal(retryAfterSeconds('Please retry in 18h39m57.9s.'), 18 * 3600 + 39 * 60 + 57.9);
  assert.equal(retryAfterSeconds('no hint here'), null);
});

test('a used-up daily quota raises ProviderLimitError without waiting', async () => {
  const { ProviderLimitError } = await import('../src/adapters/claude.ts');
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response('{"error":{"code":429,"message":"Quota exceeded ... Please retry in 18h39m57.9s."}}', { status: 429 });
  }) as typeof fetch;
  try {
    await assert.rejects(geminiTransport('k').send({ ...(params as object), max_tokens: 10 } as never),
      (err: unknown) => err instanceof ProviderLimitError && /resets in about 19 hour/.test((err as Error).message));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
