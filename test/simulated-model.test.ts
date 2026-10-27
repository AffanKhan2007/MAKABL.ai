import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featureSlug, simulatedTransport } from '../src/server/simulated-model.ts';

// The stand-in model must follow the loop's protocol (one tool per turn, then finish)
// based only on the request, since replays mean it cannot keep its own state.

type Params = Parameters<ReturnType<typeof simulatedTransport>['send']>[0];

const request = (turn: number): Params => ({
  model: 'claude-opus-5-5',
  max_tokens: 1_000,
  messages: [
    { role: 'user', content: 'Feature: Items API (crud_endpoint)\n\nBuild it.' },
    ...Array.from({ length: turn }, () => [
      { role: 'assistant' as const, content: 'x' },
      { role: 'user' as const, content: 'y' },
    ]).flat(),
  ],
});

test('plays list, write, check, finish for the feature named in the task', async () => {
  const model = simulatedTransport(0);
  const turns = await Promise.all([0, 1, 2, 3].map((t) => model.send(request(t))));
  assert.deepEqual(turns.map((m) => m.stop_reason), ['tool_use', 'tool_use', 'tool_use', 'end_turn']);
  const tools = turns.slice(0, 3).map((m) => (m.content[0] as { name: string }).name);
  assert.deepEqual(tools, ['list_files', 'write_file', 'run_checks']);
  const write = turns[1]!.content[0] as { input: { path: string; content: string } };
  assert.equal(write.input.path, 'features/items-api.ts');
  assert.match(write.input.content, /export const feature = "Items API"/);
});

test('usage has the shape of a cached loop: reads grow, writes stay small', async () => {
  const model = simulatedTransport(0);
  const [t0, t1, t2] = await Promise.all([0, 1, 2].map((t) => model.send(request(t))));
  assert.equal(t0!.usage.cache_read_input_tokens, 0);
  assert.ok(t2!.usage.cache_read_input_tokens! > t1!.usage.cache_read_input_tokens!);
  assert.ok(t1!.usage.cache_creation_input_tokens! < t0!.usage.cache_creation_input_tokens!);
});

test('feature slugs are safe file names', () => {
  assert.equal(featureSlug('Add / edit item!'), 'add-edit-item');
  assert.equal(featureSlug('../../etc'), 'etc');
  assert.equal(featureSlug('***'), 'feature');
});
