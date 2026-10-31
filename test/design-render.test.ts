import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeAdapter, type ClaudeMessage, type ClaudeTransport } from '../src/adapters/claude.ts';
import {
  DESIGN_TASK, designModel, designPrompt, drawMockup, extractHtml, framedDocument, sanitizeHtml,
} from '../src/design/render.ts';
import { usd } from '../src/domain/types.ts';
import { MemoryEventLog } from '../src/events/event-store.ts';
import { BudgetBlockedError, BudgetGate } from '../src/gate/budget-gate.ts';
import { MemoryGateStore } from '../src/gate/memory-store.ts';
import { PricingRegistry } from '../src/registry/pricing.ts';
import { seedPrices } from '../src/registry/seed.ts';

// No network: a fake transport stands in for the model.

const registry = new PricingRegistry(seedPrices);
const spec = {
  idea: 'Table bookings for a small restaurant',
  features: [{ type: 'crud' as never, name: 'Bookings', acceptance: ['Guests pick a time', 'Owner sees today'] }],
};

function fakeTransport(text: string, sent: unknown[] = []): ClaudeTransport {
  return {
    countTokens: async () => 1_500,
    send: async (params) => {
      sent.push(params);
      return {
        id: 'm1', type: 'message', role: 'assistant', model: params.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text }],
        usage: { input_tokens: 1_500, output_tokens: 3_000 },
      } as unknown as ClaudeMessage;
    },
  };
}

test('the cheapest vendor with a key draws; no key means no model', () => {
  assert.equal(designModel({}), null);
  assert.equal(designModel({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' }), 'google/gemini-3.5-flash-lite');
  assert.equal(designModel({ ANTHROPIC_API_KEY: 'a', DASHSCOPE_API_KEY: 'q' }), 'qwen/qwen3.8-flash');
  for (const id of ['qwen/qwen3.8-flash', 'google/gemini-3.5-flash-lite', 'openai/gpt-6-luna', 'anthropic/claude-haiku-5-5']) {
    assert.ok(registry.get(id), `${id} is priced in the registry`);
  }
});

test('the HTML is taken out of fences and chatter', () => {
  const reply = 'Here you go:\n```html\n<!DOCTYPE html><html><body><h1>Hi</h1></body></html>\n```\nEnjoy!';
  assert.equal(extractHtml(reply), '<!DOCTYPE html><html><body><h1>Hi</h1></body></html>');
});

test('sanitising removes anything that runs or loads, and keeps the layout', () => {
  const dirty = [
    '<html><head><link rel="stylesheet" href="https://evil.example/x.css"><meta http-equiv="refresh" content="0;url=https://evil.example">',
    '<style>@import url(https://evil.example/a.css); .h{background:url(https://evil.example/t.png)}</style></head>',
    '<body onload="steal()"><script>alert(1)</script><img src="https://evil.example/p.png" onerror="x()">',
    '<a href="javascript:alert(1)">Book</a><iframe src="https://evil.example"></iframe><svg><script>1</script></svg>',
    '<form action="https://evil.example"><label>Name</label><input name="n"><button formaction="https://evil.example">Send</button></form>',
    '</body></html>',
  ].join('');
  const clean = sanitizeHtml(dirty);
  for (const bad of ['<script', 'onload', 'onerror', 'javascript:', 'evil.example', '<iframe', '<link', '<meta', '<svg', '@import', 'formaction']) {
    assert.ok(!clean.toLowerCase().includes(bad), `still contains ${bad}: ${clean}`);
  }
  // A form's fields are part of the mockup: only the form tag goes.
  assert.match(clean, /<label>Name<\/label><input name="n"><button>Send<\/button>/);
  assert.match(clean, /<style>/);
});

test('the framed document carries a policy that blocks every load', () => {
  const doc = framedDocument('<html><head><title>x</title></head><body>ok</body></html>');
  assert.match(doc, /<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">/);
});

test('a revision sends the change and the page it changes', () => {
  const p = designPrompt(spec, { feedback: 'Bigger booking button', previousHtml: '<html>old</html>' });
  assert.match(p, /Table bookings/);
  assert.match(p, /Guests pick a time/);
  assert.match(p, /<html>old<\/html>/);
  assert.match(p, /Bigger booking button/);
});

test('a mockup is one call through the Gate: reserved, booked at the registry price, tokens recorded', async () => {
  const gate = new BudgetGate(new MemoryGateStore(new MemoryEventLog()));
  await gate.setBudget('p', { projectCap: usd(1), monthlyCap: usd(1) });
  const sent: any[] = [];
  const adapter = new ClaudeAdapter(gate, registry, fakeTransport('<!DOCTYPE html><html><body onclick="x()"><h1>Book a table</h1></body></html>', sent), 'qwen');
  const price = registry.get('qwen/qwen3.8-flash');
  const render = await drawMockup({
    caller: adapter, projectId: 'p', spec, model: price.id, version: 1, nonce: 'n1',
    taskCeiling: usd(0.25), costOf: () => Math.ceil(1_500 * 0.15 + 3_000 * 0.47),
  });
  assert.equal(sent[0].model, 'qwen3.8-flash');
  assert.equal(render.html, '<!DOCTYPE html><html><body><h1>Book a table</h1></body></html>');
  assert.deepEqual(render.tokens, { input: 1_500, output: 3_000 });
  // Qwen3.8 Flash: $0.15 in, $0.47 out per 1M tokens.
  assert.equal(await gate.spent('p'), Math.ceil(1_500 * 0.15 + 3_000 * 0.47));
  assert.equal(render.cost, await gate.spent('p'));
  const ledger = await gate.ledgerFor('p');
  assert.equal(ledger[0]!.taskId, DESIGN_TASK);
});

test('a mockup that could cross the cap is stopped before the model is called', async () => {
  const gate = new BudgetGate(new MemoryGateStore(new MemoryEventLog()));
  await gate.setBudget('p', { projectCap: 1, monthlyCap: 1 }); // one micro-dollar
  const sent: unknown[] = [];
  const adapter = new ClaudeAdapter(gate, registry, fakeTransport('<html></html>', sent), 'qwen');
  await assert.rejects(drawMockup({
    caller: adapter, projectId: 'p', spec, model: 'qwen/qwen3.8-flash', version: 1, nonce: 'n',
    taskCeiling: usd(0.25), costOf: () => 0,
  }), BudgetBlockedError);
  assert.equal(sent.length, 0);
});

test('a reply with no page is an error, not an empty mockup', async () => {
  const gate = new BudgetGate(new MemoryGateStore(new MemoryEventLog()));
  await gate.setBudget('p', { projectCap: usd(1), monthlyCap: usd(1) });
  const adapter = new ClaudeAdapter(gate, registry, fakeTransport('Sorry, I cannot help with that.'), 'qwen');
  await assert.rejects(drawMockup({
    caller: adapter, projectId: 'p', spec, model: 'qwen/qwen3.8-flash', version: 1, nonce: 'n',
    taskCeiling: usd(0.25), costOf: () => 0,
  }), /did not return a page/);
});
