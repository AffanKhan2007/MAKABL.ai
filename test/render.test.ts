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
