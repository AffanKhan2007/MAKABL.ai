import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIVE_CHECKS, NEXTJS_TEMPLATE, writeTemplate } from '../src/build/template.ts';
import { Workspace } from '../src/build/workspace.ts';
import { liveModeStatus } from '../src/server/live-mode.ts';

const temps: string[] = [];
after(async () => { for (const t of temps) await rm(t, { recursive: true, force: true }); });

test('live builds need both the API key and the unsandboxed opt-in', () => {
  assert.equal(liveModeStatus({}).available, false);
  assert.equal(liveModeStatus({}).missing.length, 2);
  assert.equal(liveModeStatus({ ANTHROPIC_API_KEY: 'k' }).available, false);
  assert.equal(liveModeStatus({ MAKABL_ALLOW_UNSANDBOXED_BUILDS: '1' }).available, false);
  assert.equal(liveModeStatus({ ANTHROPIC_API_KEY: 'k', MAKABL_ALLOW_UNSANDBOXED_BUILDS: 'true' }).available, false);
  assert.deepEqual(liveModeStatus({ ANTHROPIC_API_KEY: 'k', MAKABL_ALLOW_UNSANDBOXED_BUILDS: '1' }), { available: true, missing: [] });
});

test('the status never echoes the key', () => {
  const s = liveModeStatus({ ANTHROPIC_API_KEY: 'sk-secret-value' });
  assert.ok(!s.missing.join(' ').includes('sk-secret-value'));
});

test('the template is written only into an empty workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'makabl-tpl-'));
  temps.push(root);
  const ws = new Workspace(root);
  assert.equal(await writeTemplate(ws), true);
  assert.deepEqual(await ws.list('.'), Object.keys(NEXTJS_TEMPLATE).filter((p) => !p.startsWith('.')).concat('.gitignore').sort());
  await ws.write('app/page.tsx', 'changed');
  assert.equal(await writeTemplate(ws), false, 'a second call must not overwrite the project');
  assert.equal(await readFile(join(root, 'app/page.tsx'), 'utf8'), 'changed');
});

test('the template pins the audited Next.js release and its scripts back the live checks', () => {
  const pkg = JSON.parse(NEXTJS_TEMPLATE['package.json']!) as { dependencies: Record<string, string>; scripts: Record<string, string> };
  assert.equal(pkg.dependencies.next, '16.4.3');
  for (const check of LIVE_CHECKS) {
    const script = check.command[check.command.length - 1]!;
    assert.ok(script === 'test' || pkg.scripts[script], `${check.name} runs a script the template defines`);
  }
});
