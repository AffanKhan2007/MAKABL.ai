import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderLimitError, type ClaudeCall, type ClaudeMessage, type ModelCaller } from '../src/adapters/claude.ts';
import { SKIP_SIGNATURE, toContents } from '../src/adapters/gemini.ts';
import { FallbackCaller, type Switch } from '../src/relay/fallback.ts';

const CHAIN = ['google/a', 'google/b', 'google/c'];
const msg = { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' } as unknown as ClaudeMessage;

/** A caller whose listed models refuse with a quota error; records what it was asked. */
function fake(refuse: string[]) {
  const seen: ClaudeCall[] = [];
  const inner: ModelCaller = {
    call: async (c) => {
      seen.push(c);
      if (refuse.includes(c.model)) throw new ProviderLimitError(`${c.model} quota used up`);
      return msg;
    },
  };
  return { inner, seen };
}

const call = (over: Partial<ClaudeCall> = {}): ClaudeCall => ({
  projectId: 'p', taskId: 't', taskCeiling: 1_000_000, idempotencyKey: 'k', description: 'd',
  model: 'google/a', messages: [{ role: 'user', content: 'hi' }], maxTokens: 10, ...over,
});

test('a quota error moves the call to the next model and the switch sticks', async () => {
  const { inner, seen } = fake(['google/a']);
  const switches: Switch[] = [];
  const caller = new FallbackCaller(inner, async (s) => { switches.push(s); }, CHAIN);
  await caller.call(call());
  await caller.call(call({ idempotencyKey: 'k2' }));
  assert.deepEqual(seen.map((c) => c.model), ['google/a', 'google/b', 'google/b']);
  // A switched call gets its own Gate key, so it is reserved and priced as the new model.
  assert.deepEqual(seen.map((c) => c.idempotencyKey), ['k', 'k@google/b', 'k2@google/b']);
  assert.deepEqual(switches, [{ taskId: 't', from: 'google/a', to: 'google/b', reason: 'google/a quota used up' }]);
});

test('when every model is out, the build gets one clear error', async () => {
  const { inner } = fake(CHAIN);
  const caller = new FallbackCaller(inner, async () => {}, CHAIN);
  await assert.rejects(caller.call(call()), /Every Gemini model's free quota is used up/);
});

test('models outside the chain are not switched', async () => {
  const { inner, seen } = fake(['anthropic/x']);
  const caller = new FallbackCaller(inner, async () => {}, CHAIN);
  await assert.rejects(caller.call(call({ model: 'anthropic/x' })), /quota used up/);
  assert.equal(seen.length, 1);
});

test('history handed to another model drops the old signatures for the placeholder', async () => {
  const { inner, seen } = fake(['google/a']);
  const caller = new FallbackCaller(inner, async () => {}, CHAIN);
  const history = [
    { role: 'user', content: 'build it' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'u1', name: 'list_files', input: {}, geminiSignature: 'from-a' }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u1', content: '.' }] },
  ] as unknown as ClaudeCall['messages'];
  await caller.call(call({ messages: history }));
  const sent = toContents(seen[1]!.messages);
  assert.equal(sent[1]!.parts[0]!.thoughtSignature, SKIP_SIGNATURE);
});
