import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeAdapter, type ClaudeMessage, type ClaudeTransport } from '../src/adapters/claude.ts';
import { FeatureBuilder, type FeatureTask } from '../src/build/build-loop.ts';
import { MemoryToolLog } from '../src/build/tool-log.ts';
import { Verifier, type CheckSpec } from '../src/build/verifier.ts';
import { Workspace } from '../src/build/workspace.ts';
import { MemoryRunLog } from '../src/calibration/runs.ts';
import { usd } from '../src/domain/types.ts';
import { MemoryEventLog } from '../src/events/event-store.ts';
import { BudgetGate } from '../src/gate/budget-gate.ts';
import { observedLlmCost } from '../src/gate/llm-cost.ts';
import { MemoryGateStore } from '../src/gate/memory-store.ts';
import { PricingRegistry } from '../src/registry/pricing.ts';
import { seedPrices } from '../src/registry/seed.ts';

// The build loop against a scripted fake model. Checks are real local processes in a
// temp workspace. Nothing here calls the Claude API or spends anything.

const registry = new PricingRegistry(seedPrices);
const opus = registry.get('anthropic/claude-opus-5-5');
const USAGE = { input_tokens: 1_000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const PER_CALL = observedLlmCost(opus, USAGE);

const temps: string[] = [];
after(async () => { for (const t of temps) await rm(t, { recursive: true, force: true }); });

type Block = Record<string, unknown>;
let ids = 0;
const tool = (name: string, input: Record<string, unknown>): Block => ({ type: 'tool_use', id: `toolu_${++ids}`, name, input });
const reply = (stop: string, ...content: Block[]): ClaudeMessage => ({
  id: `msg_${++ids}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5',
  content: content.length ? content : [{ type: 'text', text: 'Done.' }],
  stop_reason: stop, stop_sequence: null, usage: { ...USAGE },
} as unknown as ClaudeMessage);

/** A transport that plays back scripted replies and records every request it receives. */
function scripted(steps: Array<ClaudeMessage | Error>) {
  const sent: Array<{ messages: unknown[] }> = [];
  const transport: ClaudeTransport = {
    countTokens: async () => 1_000,
    send: async (params) => {
      sent.push(params as unknown as { messages: unknown[] });
      const next = steps.shift();
      if (!next) throw new Error('script exhausted');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { transport, sent };
}

/** items.ts must exist and export `items`. */
const CHECK: CheckSpec = {
  name: 'items exported', gate: 'G2', timeoutMs: 20_000, testsAuthoredBy: 'platform',
  command: [process.execPath, '-e', "const s=require('fs').readFileSync('items.ts','utf8');if(!s.includes('export const items'))process.exit(1)"],
};

async function setup(steps: Array<ClaudeMessage | Error>, cap = usd(10)) {
  const root = await mkdtemp(join(tmpdir(), 'makabl-build-'));
  temps.push(root);
  const workspace = new Workspace(join(root, 'project'));
  await workspace.init();
  const events = new MemoryEventLog();
  const gate = new BudgetGate(new MemoryGateStore(events));
  await gate.setBudget('proj', { projectCap: cap, monthlyCap: cap });
  const s = scripted(steps);
  const runs = new MemoryRunLog();
  const builder = new FeatureBuilder({
    adapter: new ClaudeAdapter(gate, registry, s.transport),
    workspace, verifier: new Verifier([CHECK]), events, runs, tools: new MemoryToolLog(),
  });
  return { root, workspace, events, gate, runs, builder, ...s };
}

const task = (over: Partial<FeatureTask> = {}): FeatureTask => ({
  projectId: 'proj', taskId: 't_items', featureType: 'crud_endpoint', featureName: 'Items API',
  spec: 'Export a list of items from items.ts.', acceptance: ['items.ts exports `items`'],
  model: opus.id, taskCeiling: usd(5), retryLimit: 2, retryCostLimit: usd(5),
  maxTurns: 6, maxTokens: 4_000, quoted: { low: usd(0.01), high: usd(1) }, ...over,
});

const WRITE_OK = () => tool('write_file', { path: 'items.ts', content: 'export const items = [];\n' });
const types = async (events: MemoryEventLog) => (await events.list('proj')).map((e) => e.type);

test('a feature that passes its checks is verified and logged as a calibration run', async () => {
  const { builder, runs, events, sent, workspace, gate } = await setup([
    reply('tool_use', tool('list_files', { path: '.' })),
    reply('tool_use', WRITE_OK()),
    reply('tool_use', tool('run_checks', {})),
    reply('end_turn'),
  ]);
  const out = await builder.build(task());
  assert.equal(out.status, 'verified');
  assert.equal(out.attempts, 1);
  assert.equal(await readFile(join(workspace.root, 'items.ts'), 'utf8'), 'export const items = [];\n');

  // The second request carries the first turn's tool result back.
  const second = sent[1]!.messages as Array<{ role: string; content: unknown }>;
  assert.equal(second.length, 3);
  assert.deepEqual((second[2]!.content as Array<Record<string, unknown>>)[0]!.content, '(no files)');

  const [r] = await runs.list();
  assert.equal(r?.verified, true);
  assert.equal(r?.calls, 4);
  assert.equal(r?.cost, 4 * PER_CALL);
  assert.equal(r?.cost, await gate.spent('proj'));
  assert.deepEqual(r?.quoted, { low: usd(0.01), high: usd(1) });
  const t = await types(events);
  assert.equal(t.filter((x) => x === 'tool_executed').length, 3);
  assert.ok(t.includes('task_verified') && t.includes('calibration_recorded'));
});

test('failed checks start a new attempt that is told what failed', async () => {
  const { builder, sent, runs } = await setup([
    reply('end_turn'),                       // attempt 1 claims done without writing
    reply('tool_use', WRITE_OK()),           // attempt 2
    reply('end_turn'),
  ]);
  const out = await builder.build(task());
  assert.equal(out.status, 'verified');
  assert.equal(out.attempts, 2);
  const retryPrompt = (sent[1]!.messages as Array<{ content: string }>)[0]!.content;
  assert.match(retryPrompt, /These checks failed:\nitems exported: FAIL/);
  assert.equal((await runs.list())[0]?.attempts, 2);
});

test('the retry limit ends the build as failed, still logged for calibration', async () => {
  const { builder, runs, events } = await setup([reply('end_turn'), reply('end_turn')]);
  const out = await builder.build(task({ retryLimit: 1 }));
  assert.equal(out.status, 'failed');
  assert.equal(out.attempts, 2);
  const [r] = await runs.list();
  assert.equal(r?.verified, false);
  assert.equal(r?.attempts, 2);
  assert.ok((await types(events)).includes('task_failed'));
});

test('a provider quota error stops the build at once and is shown in the feed', async () => {
  const quota = new Error('Gemini API 429: You exceeded your current quota');
  const { builder, events, sent } = await setup([quota, quota, quota, reply('end_turn')]);
  const out = await builder.build(task());
  assert.equal(out.status, 'failed');
  assert.equal(out.attempts, 1);
  assert.match(out.status === 'failed' ? out.reason : '', /provider refused the call: Gemini API 429/);
  assert.equal(sent.length, 3); // the call and its retries, then no second attempt
  const failed = (await events.list('proj')).find((e) => e.type === 'model_call_failed');
  assert.match(String(failed?.payload.error), /429/);
  assert.ok(!(await types(events)).includes('checks_run'));
});

test('a brief network error is retried as a new attempt', async () => {
  const reset = new Error('read ECONNRESET');
  const { builder, events } = await setup([reset, reset, reset, reply('tool_use', WRITE_OK()), reply('end_turn')]);
  const out = await builder.build(task());
  assert.equal(out.status, 'verified');
  assert.equal(out.attempts, 2);
  assert.ok((await types(events)).includes('model_call_failed'));
});

test('the retry cost limit stops new attempts', async () => {
  const { builder } = await setup([reply('end_turn')]);
  const out = await builder.build(task({ retryCostLimit: PER_CALL }));
  assert.equal(out.status, 'failed');
  assert.equal(out.attempts, 1);
  assert.match(out.status === 'failed' ? out.reason : '', /Retry cost limit/);
});

test('paths outside the project are refused and reported to the model', async () => {
  const { builder, root, sent } = await setup([
    reply('tool_use', tool('write_file', { path: '../evil.ts', content: 'x' })),
    reply('tool_use', WRITE_OK()),
    reply('end_turn'),
  ]);
  await builder.build(task());
  assert.equal(existsSync(join(root, 'evil.ts')), false);
  const result = ((sent[1]!.messages as Array<{ content: unknown }>)[2]!.content as Array<Record<string, unknown>>)[0]!;
  assert.equal(result.is_error, true);
  assert.match(String(result.content), /escapes the project root/);
});

test('tool calls in a turn cut off by max_tokens are not run', async () => {
  const { builder, workspace, sent } = await setup([
    reply('max_tokens', WRITE_OK()),
    reply('tool_use', WRITE_OK()),
    reply('end_turn'),
  ]);
  const out = await builder.build(task());
  assert.equal(out.status, 'verified');
  const result = ((sent[1]!.messages as Array<{ content: unknown }>)[2]!.content as Array<Record<string, unknown>>)[0]!;
  assert.equal(result.is_error, true);
  assert.match(String(result.content), /max_tokens/);
  assert.ok(existsSync(join(workspace.root, 'items.ts')));
});

test('a refusal ends the build without running its tools or retrying', async () => {
  const { builder, workspace, runs, sent } = await setup([reply('refusal', WRITE_OK())]);
  const out = await builder.build(task());
  assert.equal(out.status, 'refused');
  assert.equal(sent.length, 1);
  assert.equal(existsSync(join(workspace.root, 'items.ts')), false);
  assert.equal((await runs.list())[0]?.verified, false);
});

test('a budget block pauses; resuming replays earlier turns for free and finishes', async () => {
  // Each call reserves ~$0.19 and costs ~$0.014: with a $0.21 cap, the third call blocks.
  const { builder, gate, runs, sent, events } = await setup([
    reply('tool_use', tool('list_files', { path: '.' })),
    reply('tool_use', WRITE_OK()),
    reply('end_turn'),
  ], usd(0.21));
  const first = await builder.build(task());
  assert.equal(first.status, 'paused');
  assert.equal(sent.length, 2);
  assert.equal((await runs.list()).length, 0, 'a paused build is not logged yet');

  if (first.status !== 'paused') return;
  await gate.decide('proj', first.approval.id, 'approved', usd(1));
  const resumed = await builder.build(task());
  assert.equal(resumed.status, 'verified');
  assert.equal(sent.length, 3, 'only the blocked turn is sent; the first two replay');
  // The resumed history starts exactly as before the pause, although the workspace has
  // changed since: the replayed list_files result comes from the tool log, not a re-run.
  assert.deepEqual(sent[2]!.messages.slice(0, 3), sent[1]!.messages);
  // Tools ran once each, not again on replay.
  assert.equal((await types(events)).filter((x) => x === 'tool_executed').length, 2);
  const [r] = await runs.list();
  assert.equal(r?.cost, 3 * PER_CALL);
  assert.equal(r?.cost, await gate.spent('proj'));
});

test('a failed model call retries the same turn under a new key; its worst case is booked', async () => {
  const { builder, gate, runs } = await setup([
    new Error('connection reset'),
    reply('tool_use', WRITE_OK()),
    reply('end_turn'),
  ]);
  const out = await builder.build(task());
  assert.equal(out.status, 'verified');
  assert.equal(out.attempts, 1);
  const ledger = await gate.ledgerFor('proj');
  assert.equal(ledger[0]?.basis, 'estimated');
  assert.match(ledger[1]?.description ?? '', /retry 1/);
  const [r] = await runs.list();
  assert.equal(r?.cost, await gate.spent('proj'));
  assert.equal(r?.calls, 3);
});

test('a turn that keeps failing ends the attempt and the next attempt starts fresh', async () => {
  const { builder } = await setup([
    new Error('down'), new Error('down'), new Error('down'),   // attempt 1, turn 1 and both retries
    reply('tool_use', WRITE_OK()),
    reply('end_turn'),
  ]);
  const out = await builder.build(task());
  assert.equal(out.status, 'verified');
  assert.equal(out.attempts, 2);
});

test('a build cut off mid-call resumes after its orphaned reservation is recovered', async () => {
  const { builder, gate, sent, runs } = await setup([
    reply('tool_use', WRITE_OK()),
    reply('end_turn'),
  ]);
  // Simulate a crash: turn 1's reservation was taken, then the process died.
  const orphan = await gate.authorize({
    projectId: 'proj', taskId: 't_items', taskCeiling: usd(5), idempotencyKey: 't_items:a1:t1',
    worstCase: usd(0.5), description: 'cut off',
  });
  assert.equal(orphan.ok, true);
  assert.equal(await gate.recoverInterrupted('proj'), 1);
  const [booked] = await gate.ledgerFor('proj');
  assert.deepEqual([booked?.amount, booked?.basis], [usd(0.5), 'estimated']);

  const out = await builder.build(task());
  assert.equal(out.status, 'verified');
  assert.equal(out.attempts, 1, 'the interrupted turn is retried, not the whole attempt');
  assert.equal(sent.length, 2);
  // The run includes the two real calls; the orphan predates the run.
  assert.equal((await runs.list())[0]?.calls, 2);
});

// Symlink refusal is not tested here: creating a symlink on Windows needs admin rights.
test('the workspace refuses absolute paths and escapes from the root', async () => {
  const { workspace } = await setup([]);
  await assert.rejects(workspace.write('C:/Windows/x.txt', 'x'), /relative/);
  await assert.rejects(workspace.write('/etc/x', 'x'), /relative/);
  await assert.rejects(workspace.read('a/../../x'), /escapes/);
  await workspace.write('src/lib/a.ts', 'ok');
  assert.deepEqual(await workspace.list('.'), ['src/lib/a.ts']);
});
