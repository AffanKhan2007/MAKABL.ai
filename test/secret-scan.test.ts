import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanText, scanWorkspace } from '../src/build/secret-scan.ts';
import { Workspace } from '../src/build/workspace.ts';

// The fake credentials below are built from pieces so this file itself does not trip
// secret scanners.
const fake = {
  anthropic: 'sk-ant-' + 'api03-' + 'A'.repeat(40),
  aws: 'AKIA' + 'ABCDEFGHIJKLMNOP',
  github: 'ghp_' + 'a'.repeat(36),
  stripe: 'sk_' + 'live_' + 'b'.repeat(24),
  key: '-----BEGIN ' + 'PRIVATE KEY-----',
};

test('finds common credential shapes and reports kind and line, never the value', () => {
  const text = [
    'const ok = 1;',
    `const k = "${fake.anthropic}";`,
    `aws = '${fake.aws}'`,
    `token: "${fake.github}"`,
    `STRIPE="${fake.stripe}"`,
    fake.key,
    `const password = "correct-horse-battery";`,
  ].join('\n');
  const found = scanText('lib/x.ts', text);
  assert.deepEqual(found.map((f) => f.line), [2, 3, 4, 5, 6, 7]);
  assert.equal(found[0]!.kind, 'Anthropic API key');
  assert.ok(!JSON.stringify(found).includes(fake.anthropic.slice(10)));
});

test('ordinary code is not flagged', () => {
  const text = [
    "const apiKey = process.env.ANTHROPIC_API_KEY;",
    "const password = form.get('password');",
    "export const health = (): 'ok' => 'ok';",
    "const short = 'sk-ant-x';",
  ].join('\n');
  assert.deepEqual(scanText('lib/y.ts', text), []);
});

const temps: string[] = [];
after(async () => { for (const t of temps) await rm(t, { recursive: true, force: true }); });

test('flags .env files and secrets in the workspace, skipping lockfiles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'makabl-scan-'));
  temps.push(root);
  const ws = new Workspace(root);
  await ws.write('.env.local', 'X=1');
  await ws.write('.env.example', 'X=');
  await ws.write('package-lock.json', `{"x": "${fake.github}"}`);
  await ws.write('app/page.tsx', `const k = '${fake.aws}';`);
  const found = await scanWorkspace(ws);
  assert.deepEqual(found.map((f) => f.file).sort(), ['.env.local', 'app/page.tsx']);
});
