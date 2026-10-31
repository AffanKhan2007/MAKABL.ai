import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { previewOf, startPreview, stopPreview } from '../src/build/preview.ts';

// A stand-in for a built Next.js project: node_modules/next/dist/bin/next is a tiny
// script that serves a page on the port it is given (or exits, to simulate a crash).

const temps: string[] = [];
after(async () => { for (const t of temps) await rm(t, { recursive: true, force: true }); });

const FAKE_NEXT = `
const http = require('node:http');
const args = process.argv.slice(2);
if (args[0] === 'build') { require('node:fs').mkdirSync('.next', { recursive: true }); require('node:fs').writeFileSync('.next/BUILD_ID', 'x'); process.exit(0); }
if (process.env.CRASH === '1' || require('node:fs').existsSync('crash')) { console.error('boom: app failed to start'); process.exit(1); }
const port = Number(args[args.indexOf('-p') + 1]);
http.createServer((req, res) => res.end('<h1>Generated app</h1>' + (process.env.ANTHROPIC_API_KEY ? 'LEAKED' : ''))).listen(port, '127.0.0.1');
`;

async function project(opts: { built?: boolean; crash?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'makabl-preview-'));
  temps.push(dir);
  await mkdir(join(dir, 'node_modules', 'next', 'dist', 'bin'), { recursive: true });
  await writeFile(join(dir, 'node_modules', 'next', 'dist', 'bin', 'next'), FAKE_NEXT);
  if (opts.built !== false) {
    await mkdir(join(dir, '.next'));
    await writeFile(join(dir, '.next', 'BUILD_ID'), 'x');
  }
  if (opts.crash) await writeFile(join(dir, 'crash'), '');
  return dir;
}

const get = (url: string) => fetch(url.replace('localhost', '127.0.0.1'), { signal: AbortSignal.timeout(2_000) });

test('starts the app, serves it, reuses it, and stops it', async () => {
  process.env.ANTHROPIC_API_KEY = 'secret-for-test';
  try {
    const dir = await project();
    const p = await startPreview('t1', dir);
    assert.equal(p.status, 'running');
    const body = await (await get(p.url!)).text();
    assert.equal(body, '<h1>Generated app</h1>', 'served, and the API key did not reach the app');
    assert.equal((await startPreview('t1', dir)).port, p.port);
    stopPreview('t1');
    await new Promise((r) => setTimeout(r, 500));
    await assert.rejects(get(p.url!));
    assert.equal(previewOf('t1')?.status, 'stopped');
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('builds first when there is no production build', async () => {
  const dir = await project({ built: false });
  const p = await startPreview('t2', dir);
  assert.equal(p.status, 'running');
  stopPreview('t2');
});

test('a crashing app is reported as failed with its output', async () => {
  const dir = await project({ crash: true });
  const p = await startPreview('t3', dir);
  assert.equal(p.status, 'failed');
  assert.match(p.log, /boom: app failed to start/);
});

test('a project without installed dependencies fails clearly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'makabl-preview-'));
  temps.push(dir);
  const p = await startPreview('t4', dir);
  assert.equal(p.status, 'failed');
  assert.match(p.log, /no installed dependencies/);
});
