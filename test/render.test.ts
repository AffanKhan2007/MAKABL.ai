import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractHtml, renderDocument, renderPrompt, sanitizeHtml, wireframeOf } from '../src/relay/render.ts';

const PAGE = '<!doctype html><html><head><style>body{font-family:sans-serif;background:#fff}h1{color:#0a7}</style></head><body><h1>Specials</h1><p>Latte $4</p></body></html>';

test('finds the HTML in a fenced or bare reply, and rejects a reply with none', () => {
  assert.equal(extractHtml(`Here you go:\n\`\`\`html\n${PAGE}\n\`\`\`\nEnjoy`), PAGE);
  assert.equal(extractHtml(PAGE), PAGE);
  assert.equal(extractHtml('I cannot draw that.'), null);
  assert.equal(extractHtml('<html></html>'), null, 'too short to be a page');
});

test('scripts, frames, handlers, remote resources and javascript: links are removed', () => {
  const dirty = `<html><head><link rel="stylesheet" href="https://evil.test/a.css"><style>@import url(https://evil.test/x.css);
    .a{background:url(https://evil.test/p.png)} .b{background:url(data:image/png;base64,AAAA)}</style>
    <script>alert(1)</script></head><body onload="steal()"><a href="javascript:alert(1)" onclick="x()">x</a>
    <img src="https://evil.test/t.gif"><img src="data:image/png;base64,AAAA"><iframe src="https://evil.test"></iframe>
    <form action="https://evil.test"><input></form><meta http-equiv="refresh" content="0;url=https://evil.test"></body></html>`;
  const clean = sanitizeHtml(dirty);
  for (const bad of ['<script', 'alert(', 'onload', 'onclick', 'javascript:', 'evil.test', '<iframe', '<link', '<form', 'http-equiv', '@import']) {
    assert.ok(!clean.includes(bad), `still contains ${bad}`);
  }
  assert.ok(clean.includes('data:image/png;base64,AAAA'), 'inline data images are kept');
  assert.ok(clean.includes('<body'), 'the markup stays');
});

test('a clean page survives untouched, and the document carries a policy that forbids everything else', () => {
  assert.equal(sanitizeHtml(PAGE), PAGE);
  const doc = renderDocument(PAGE);
  assert.match(doc, /Content-Security-Policy[^>]*default-src 'none'/);
  assert.match(doc, /<h1>Specials<\/h1>/);
  assert.match(renderDocument('<h1>No head</h1>'), /<head><meta http-equiv="Content-Security-Policy"/);
});

test('the prompt carries the page, the wireframe, the previous version and the feedback', () => {
  const p = renderPrompt({
    idea: 'A cafe site', page: 'Home', features: [{ name: 'Specials', type: 'page' }],
    wireframe: '## Wireframe\n```\n[header]\n```', previous: '<html>old</html>', feedback: 'make it warmer',
  });
  for (const part of ['A cafe site', 'Page to draw: Home', 'Specials', '[header]', '<html>old</html>', 'make it warmer']) assert.ok(p.includes(part), part);
  assert.ok(!renderPrompt({ idea: 'x', page: 'Home', features: [] }).includes('The user asked'));
});

test('pulls the wireframe section out of an architect brief', () => {
  const brief = '## Wireframe\nHome page\n```\n[nav]\n```\n\n## Data\n- items\n';
  assert.equal(wireframeOf(brief), '## Wireframe\nHome page\n```\n[nav]\n```');
  assert.equal(wireframeOf('## Files\n- a'), undefined);
});

import { chosenDesign, designReference, DESIGN_GUIDE } from '../src/relay/render.ts';
import { reviewPrompt } from '../src/relay/relay.ts';

const ev = (type: string, payload: Record<string, unknown>) => ({ type, payload });

test('the chosen design is the latest mark, resolved to that version, and nothing when none was chosen', () => {
  const events = [
    ev('relay_render', { n: 1, page: 'Home', html: '<p>one</p>' }),
    ev('relay_render', { n: 2, page: 'Home', html: '<p>two</p>' }),
    ev('relay_render_chosen', { n: 1 }),
    ev('relay_render_chosen', { n: 2 }),
  ];
  assert.deepEqual(chosenDesign(events), { n: 2, page: 'Home', html: '<p>two</p>' });
  assert.equal(chosenDesign(events.slice(0, 2)), null);
  assert.equal(chosenDesign([...events.slice(0, 1), ev('relay_render_chosen', { n: 9 })]), null, 'a mark for a missing version is ignored');
});

test('the builder and reviewer are told to match the render, and every build gets the design standard', () => {
  const ref = designReference({ n: 2, page: 'Home', html: '<h1>Menu</h1>' });
  for (const part of ['version 2', '"Home" page', 'layout, section order', 'Reference HTML:', '<h1>Menu</h1>']) assert.ok(ref.includes(part), part);
  assert.ok(reviewPrompt({ design: ref, feature: 'Home', acceptance: [], checks: [], files: [] }).includes('how closely the code follows that design'));
  assert.ok(!reviewPrompt({ feature: 'Home', acceptance: [], checks: [], files: [] }).includes('Reference HTML'));
  for (const rule of ['CSS variables', 'contrast', 'prefers-reduced-motion', 'lorem ipsum', 'empty']) assert.ok(DESIGN_GUIDE.includes(rule), rule);
});

import { designFacts, designFor, designTargets, fidelity } from '../src/relay/render.ts';

const HOME = '<html><head><style>body{font-family:Georgia,serif;background:#FFF8F0;color:#5c3a21}a{color:#d48344}</style></head><body><h1>Crumb &amp; Co.</h1><button>Order now</button></body></html>';

test('a page with no explicit choice is still built to its newest render, and a choice is not displaced', () => {
  const events = [
    ev('relay_render', { n: 1, page: 'Home', html: 'a' }), ev('relay_render', { n: 2, page: 'Home', html: 'b' }),
    ev('relay_render', { n: 3, page: 'Menu', html: 'c' }),
  ];
  assert.deepEqual(designTargets(events).map((d) => d.n), [2, 3]);
  const chosen = [...events, ev('relay_render', { n: 4, page: 'Home', html: 'd' }), ev('relay_render_chosen', { n: 2 })];
  assert.equal(designTargets(chosen).find((d) => d.page === 'Home')!.n, 2);
  assert.equal(designFor(designTargets(events), 'Menu page')!.page, 'Menu');
  assert.equal(designFor(designTargets(events), 'Checkout')!.page, 'Home');
});

test('the facts a render commits to are measured in the built code', () => {
  const f = designFacts(HOME);
  assert.deepEqual(f.colours.sort(), ['#5c3a21', '#d48344', '#fff8f0']);
  assert.ok(f.texts.includes('Crumb & Co.') && f.texts.includes('Order now'));
  const d = { n: 1, page: 'Home', html: HOME };
  assert.equal(fidelity(d, [':root{--a:#5C3A21;--b:#d48344;--c:#fff8f0} <h1>Crumb & Co.</h1><button>Order now</button>']).score, 1);
  const miss = fidelity(d, [':root{--a:#5c3a21} <h1>Bakery</h1>']);
  assert.ok(miss.score < 0.5 && miss.missingColours.includes('#d48344') && miss.missingTexts.includes('Order now'));
});

import { featurePoints, qualityScore } from '../src/relay/quality.ts';

test('quality counts only what was measured, and retries cost points', () => {
  assert.equal(qualityScore({ verified: true, attempts: 1, fidelity: 1, verdict: 'APPROVE' }).score, 100);
  assert.equal(qualityScore({ verified: true, attempts: 1, fidelity: null, verdict: null }).score, 100, 'nothing measured is left out, not failed');
  assert.equal(qualityScore({ verified: true, attempts: 1, fidelity: 0.5, verdict: null }).score, 75);
  assert.ok(qualityScore({ verified: true, attempts: 3, fidelity: 1, verdict: 'APPROVE' }).score < 100);
  assert.equal(qualityScore({ verified: false, attempts: 2, fidelity: 0, verdict: 'REVISE' }).score, 8);
});

test('feature points add up the feature, its repair, review and overseer costs in build order', () => {
  const events = [
    { type: 'task_verified', taskId: 'a', payload: { attempts: 1 } },
    { type: 'relay_fidelity', taskId: 'a', payload: { score: 0.5 } },
    { type: 'task_verified', taskId: 'b', payload: { attempts: 1 } },
  ];
  const cost = new Map([['a', 100], ['a:align', 20], ['review:a', 5], ['review:oversee:a', 5], ['b', 50]]);
  const pts = featurePoints([{ name: 'A', taskId: 'a' }, { name: 'B', taskId: 'b' }, { name: 'C', taskId: 'c' }], events, cost);
  assert.deepEqual(pts.map((p) => [p.feature, p.cost, p.cumulative, p.score]), [['A', 130, 130, 75], ['B', 50, 180, 100]]);
});
