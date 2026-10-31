import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geminiTransport, toContents, toMessage } from '../src/adapters/gemini.ts';
import { liveModeStatus } from '../src/server/live-mode.ts';

test('a function call becomes a tool_use turn that keeps its thought signature', () => {
  const msg = toMessage({
    candidates: [{
      finishReason: 'STOP',
      content: { parts: [
        { text: 'thinking', thought: true },
        { functionCall: { name: 'write_file', args: { path: 'a.ts', content: 'x' } }, thoughtSignature: 'sig-1' },
      ] },
    }],
    usageMetadata: { promptTokenCount: 1000, cachedContentTokenCount: 200, candidatesTokenCount: 50, thoughtsTokenCount: 30 },
  }, 'gemini-3.1-pro-preview');

  assert.equal(msg.stop_reason, 'tool_use');
  assert.equal(msg.content.length, 1);
  const block = msg.content[0] as unknown as Record<string, unknown>;
  assert.equal(block.type, 'tool_use');
  assert.equal(block.name, 'write_file');
  assert.deepEqual(block.input, { path: 'a.ts', content: 'x' });
  assert.equal(block.geminiSignature, 'sig-1');
  assert.equal(msg.usage.input_tokens, 800);
  assert.equal(msg.usage.cache_read_input_tokens, 200);
  assert.equal(msg.usage.output_tokens, 80);
});

test('stop reasons map to what the build loop expects', () => {
  const finish = (finishReason: string) => toMessage({ candidates: [{ finishReason, content: { parts: [{ text: 'x' }] } }] }, 'm').stop_reason;
  assert.equal(finish('STOP'), 'end_turn');
  assert.equal(finish('MAX_TOKENS'), 'max_tokens');
  assert.equal(finish('SAFETY'), 'refusal');
  assert.equal(toMessage({ promptFeedback: { blockReason: 'SAFETY' } }, 'm').stop_reason, 'refusal');
});

test('history round-trips: tool results find their tool name, signatures go back', () => {
  const call = toMessage({ candidates: [{ content: { parts: [{ functionCall: { name: 'list_files', args: { path: '.' } }, thoughtSignature: 's' }] } }] }, 'm');
  const id = (call.content[0] as unknown as { id: string }).id;
  const contents = toContents([
    { role: 'user', content: 'Build the page' },
    { role: 'assistant', content: call.content } as never,
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'app/page.tsx', is_error: false }] },
  ]);

  assert.deepEqual(contents.map((c) => c.role), ['user', 'model', 'user']);
  assert.deepEqual(contents[1]!.parts[0], { functionCall: { name: 'list_files', args: { path: '.' } }, thoughtSignature: 's' });
  assert.deepEqual(contents[2]!.parts[0], { functionResponse: { name: 'list_files', response: { output: 'app/page.tsx' } } });
});

test('requests carry the system prompt, tools as JSON schema and the output limit', async () => {
  const sent: Array<{ path: string; body: Record<string, unknown> }> = [];
  const transport = geminiTransport(async (path, body) => {
    sent.push({ path, body: body as Record<string, unknown> });
    return path.endsWith(':countTokens') ? { totalTokens: 42 } : { candidates: [{ content: { parts: [{ text: 'done' }] } }] };
  });
  const params = {
    model: 'gemini-3.1-pro-preview',
    system: 'You build features.',
    messages: [{ role: 'user' as const, content: 'hi' }],
    tools: [{ name: 'run_checks', description: 'Run checks', input_schema: { type: 'object' as const, properties: {} } }],
  };

  assert.equal(await transport.countTokens(params), 42);
  const msg = await transport.send({ ...params, max_tokens: 1000 });
  assert.equal(msg.stop_reason, 'end_turn');

  const gen = sent[1]!;
  assert.equal(gen.path, 'models/gemini-3.1-pro-preview:generateContent');
  assert.deepEqual(gen.body.systemInstruction, { parts: [{ text: 'You build features.' }] });
  assert.deepEqual(gen.body.generationConfig, { maxOutputTokens: 1000 });
  assert.deepEqual(gen.body.tools, [{ functionDeclarations: [{ name: 'run_checks', description: 'Run checks', parametersJsonSchema: { type: 'object', properties: {} } }] }]);
});

test('a Gemini key enables live builds for Gemini models only', () => {
  const env = { GEMINI_API_KEY: 'g', MAKABL_ALLOW_UNSANDBOXED_BUILDS: '1' };
  assert.equal(liveModeStatus(env, 'google').available, true);
  assert.equal(liveModeStatus(env, 'anthropic').available, false);
  assert.equal(liveModeStatus(env).available, true);
  assert.ok(!liveModeStatus({ GEMINI_API_KEY: 'secret-g' }, 'google').missing.join(' ').includes('secret-g'));
});

test('reads how long Gemini asks to wait, from RetryInfo or the message text', async () => {
  const { retryAfterSeconds } = await import('../src/adapters/gemini.ts');
  assert.equal(retryAfterSeconds('{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay": "37s"}'), 37);
  assert.equal(retryAfterSeconds('Please retry in 18h39m57.9s.'), 18 * 3600 + 39 * 60 + 57.9);
  assert.equal(retryAfterSeconds('no hint here'), null);
});

test('a used-up daily quota raises ProviderLimitError at once, without waiting or retrying', async () => {
  const { fetchPost } = await import('../src/adapters/gemini.ts');
  const { ProviderLimitError } = await import('../src/adapters/claude.ts');
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response('{"error":{"code":429,"message":"Quota exceeded ... Please retry in 18h39m57.9s."}}', { status: 429 });
  }) as typeof fetch;
  try {
    await assert.rejects(fetchPost('k')('models/gemini-3.6-flash:generateContent', {}),
      (err: unknown) => err instanceof ProviderLimitError && /gemini-3\.6-flash quota is used up.*about 19 hour/.test((err as Error).message));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
