import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeAdapter, type ClaudeCall, type ClaudeMessage, type ClaudeTransport } from '../src/adapters/claude.ts';
import { usd } from '../src/domain/types.ts';
import { MemoryEventLog } from '../src/events/event-store.ts';
import { BudgetBlockedError, BudgetGate } from '../src/gate/budget-gate.ts';
import { MemoryGateStore } from '../src/gate/memory-store.ts';
import { PricingRegistry } from '../src/registry/pricing.ts';
import { seedPrices } from '../src/registry/seed.ts';
import { Negotiator, SLACK_SHARE, type Decision } from '../src/relay/negotiator.ts';
import { phaseOfTask, RelayCaller, reviewTaskId, textOf, verdictOf } from '../src/relay/relay.ts';

// No network: fake transports stand in for the vendors. Nothing here spends money.

const registry = new PricingRegistry(seedPrices);
const P = 'proj_relay';

test('allowances follow the plan, with a fifth held back as slack', () => {
  const n = Negotiator.fromPlan(usd(10), [
    { phase: 'spec', expected: usd(0.1) }, { phase: 'build', expected: usd(0.9) },
  ]);
  const { phases, slack } = n.snapshot();
  assert.equal(phases[0]!.allowance, usd(10 * (1 - SLACK_SHARE) * 0.1));
  assert.equal(phases[1]!.allowance, usd(10 * (1 - SLACK_SHARE) * 0.9));
  assert.equal(slack + phases[0]!.allowance + phases[1]!.allowance, usd(10));
});

test('a short phase is granted from slack, then lent spare allowance, then escalated', () => {
  // Cap $1: build $0.40, review $0.40 (expects only $0.10), slack $0.20.
  const n = Negotiator.fromPlan(usd(1), [
    { phase: 'build', expected: usd(1) }, { phase: 'review', expected: usd(1) },
  ]);
  n.phases.get('review')!.expected = usd(0.1);
  assert.equal(n.request('build', usd(0.3), 'fits'), null);
  n.spend('build', usd(0.3));

  const granted = n.request('build', usd(0.25), 'retry after failed checks')!;
  assert.equal(granted.outcome, 'granted');
  assert.equal(granted.amount, usd(0.15));
  n.spend('build', usd(0.25));

  const lent = n.request('build', usd(0.2), 'longer than planned')!;
  assert.equal(lent.outcome, 'reassigned');
  assert.equal(lent.from, 'review');
  n.spend('build', usd(0.2));

  const escalated = n.request('build', usd(0.5), 'still going')!;
  assert.equal(escalated.outcome, 'escalated');
  assert.equal(n.decisions.length, 3);
});

test('a finished phase hands back what it did not spend', () => {
  const n = Negotiator.fromPlan(usd(1), [{ phase: 'spec', expected: usd(1) }, { phase: 'build', expected: usd(1) }]);
  const before = n.slack;
  n.spend('spec', usd(0.1));
  const back = n.finish('spec')!;
  assert.equal(back.outcome, 'returned');
  assert.equal(back.amount, usd(0.3));
  assert.equal(n.slack, before + usd(0.3));
  assert.equal(n.finish('spec'), null);
});

test('task ids map to relay phases', () => {
  assert.equal(phaseOfTask('relay:spec'), 'spec');
  assert.equal(phaseOfTask('relay:architect'), 'architect');
  assert.equal(phaseOfTask(reviewTaskId('f-items-abc')), 'review');
  assert.equal(phaseOfTask('f-items-abc'), 'build');
});

function reply(text: string, model: string): ClaudeMessage {
  return {
    id: 'm', type: 'message', role: 'assistant', model,
    content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 2_000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as ClaudeMessage;
}

function transport(text: string, model: string) {
  const sent: string[] = [];
  const t: ClaudeTransport = {
    countTokens: async () => 2_000,
    send: async (params) => { sent.push(params.model); return reply(text, model); },
  };
  return { t, sent };
}

async function relaySetup(cap = usd(5)) {
  const gate = new BudgetGate(new MemoryGateStore(new MemoryEventLog()));
  await gate.setBudget(P, { projectCap: cap, monthlyCap: cap });
  const google = transport('## Goal\nBook tables', 'gemini-3.5-flash-lite');
  const anthropic = transport('VERDICT: APPROVE\n- fine', 'claude-haiku-5-5');
  const negotiator = Negotiator.fromPlan(cap, [
    { phase: 'spec', expected: usd(0.01) }, { phase: 'build', expected: usd(1) }, { phase: 'review', expected: usd(0.01) },
  ]);
  const decisions: Decision[] = [];
  const caller = new RelayCaller({
    adapters: {
      google: new ClaudeAdapter(gate, registry, google.t, 'google'),
      anthropic: new ClaudeAdapter(gate, registry, anthropic.t, 'anthropic'),
    },
    registry, negotiator, onDecision: async (d) => { decisions.push(d); },
  });
  return { gate, caller, negotiator, decisions, google, anthropic };
}

const call = (taskId: string, model: string, key: string, maxTokens = 1_000): ClaudeCall => ({
  projectId: P, taskId, taskCeiling: usd(5), idempotencyKey: key, description: `${taskId} call`,
  model, maxTokens, messages: [{ role: 'user', content: 'go' }],
});

test('each phase runs on its own vendor, books its cost to that phase, and replays for free', async () => {
  const { gate, caller, negotiator, google, anthropic } = await relaySetup();
  const spec = await caller.call(call('relay:spec', 'google/gemini-3.5-flash-lite', 'spec'));
  const review = await caller.call(call(reviewTaskId('f1'), 'anthropic/claude-haiku-5-5', 'review'));
  assert.equal(textOf(spec), '## Goal\nBook tables');
  assert.equal(verdictOf(textOf(review)), 'approve');
  assert.deepEqual(google.sent, ['gemini-3.5-flash-lite']);
  assert.deepEqual(anthropic.sent, ['claude-haiku-5-5']);
  assert.ok(negotiator.phases.get('spec')!.spent > 0);
  assert.ok(negotiator.phases.get('review')!.spent > 0);
  assert.equal(negotiator.phases.get('build')!.spent, 0);

  const spent = await gate.spent(P);
  await caller.call(call('relay:spec', 'google/gemini-3.5-flash-lite', 'spec'));
  assert.equal(google.sent.length, 1);
  assert.equal(await gate.spent(P), spent);
});

test('a phase over its allowance negotiates before the call, and the Gate still holds the cap', async () => {
  const { caller, decisions } = await relaySetup(usd(0.05));
  // Gemini Flash-Lite at 30K output tokens is worst case ~$0.075: more than the whole cap.
  await assert.rejects(
    caller.call(call('relay:spec', 'google/gemini-3.5-flash-lite', 'big', 30_000)),
    BudgetBlockedError,
  );
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0]!.outcome, 'escalated');
  assert.match(decisions[0]!.reason, /relay:spec call could cost up to \$/);
});

test('a vendor without an adapter is refused', async () => {
  const { caller } = await relaySetup();
  await assert.rejects(caller.call(call('relay:architect', 'openai/gpt-6.1-sol', 'x')), /no live adapter for openai/);
});

test('a call the provider refused is released, not booked, and a quota error is not retried', async () => {
  const { ProviderLimitError } = await import('../src/adapters/claude.ts');
  const gate = new BudgetGate(new MemoryGateStore(new MemoryEventLog()));
  await gate.setBudget(P, { projectCap: usd(5), monthlyCap: usd(5) });
  let sends = 0;
  const limited: ClaudeTransport = {
    countTokens: async () => 1_000,
    send: async () => { sends++; throw new ProviderLimitError('quota used up'); },
  };
  const adapter = new ClaudeAdapter(gate, registry, limited, 'google');
  await assert.rejects(adapter.call(call('relay:spec', 'google/gemini-3.6-flash', 'q')), ProviderLimitError);
  assert.equal(sends, 1);
  assert.equal(await gate.spent(P), 0);
  assert.equal((await gate.ledgerFor(P)).length, 0);
});

test('asking for room: granted from slack, moved from a phase that will not need it, or declined', () => {
  const n = Negotiator.fromPlan(usd(1), [
    { phase: 'build', expected: usd(1) }, { phase: 'review', expected: usd(1) },
  ]);
  n.phases.get('review')!.expected = usd(0.1);

  const slack = n.ask('build', usd(0.1), 'three migrations');
  assert.equal(slack.outcome, 'granted');
  assert.equal(slack.by, 'model');
  assert.equal(n.phases.get('build')!.allowance, usd(0.5));

  const moved = n.ask('build', usd(0.2), 'larger schema');
  assert.equal(moved.outcome, 'reassigned');
  assert.equal(moved.from, 'review');

  const declined = n.ask('build', usd(0.9), 'everything');
  assert.equal(declined.outcome, 'declined');
  assert.equal(n.phases.get('build')!.allowance, usd(0.7), 'a declined request changes nothing');
});

test('when nothing can be moved the allowance is not raised, so the Gate blocks the call and asks the user', async () => {
  const gate = new BudgetGate(new MemoryGateStore(new MemoryEventLog()));
  await gate.setBudget(P, { projectCap: usd(0.05), monthlyCap: usd(0.05) });
  const google = transport('## Goal\nx', 'gemini-3.5-flash-lite');
  const negotiator = Negotiator.fromPlan(usd(0.05), [{ phase: 'spec', expected: usd(0.0001) }, { phase: 'build', expected: usd(0.0001) }]);
  const caller = new RelayCaller({
    adapters: { google: new ClaudeAdapter(gate, registry, google.t, 'google') },
    registry, negotiator, onDecision: async () => {},
  });
  const before = negotiator.phases.get('spec')!.allowance;
  await assert.rejects(caller.call(call('relay:spec', 'google/gemini-3.5-flash-lite', 'tiny', 30_000)), BudgetBlockedError);
  assert.equal(negotiator.phases.get('spec')!.allowance, before, 'escalation does not quietly raise the allowance');
  assert.equal(google.sent.length, 0, 'nothing was sent to the provider');
  assert.equal((await gate.pendingApprovals(P)).length, 1, 'the owner is asked');
});
