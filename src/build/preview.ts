import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

// Runs the app a live build produced, so it can be opened and clicked through (#15).
//
// The generated project is started with Next.js's own CLI under plain `node` (not via
// npm or cmd.exe), so the process we hold is the server itself and stopping it stops
// the app. It gets the same stripped environment as the checks: no provider keys.
//
// This is generated code running on this machine. It is shown to the user as such;
// the planned sandbox would run it in a container instead.

export type PreviewStatus = 'building' | 'starting' | 'running' | 'failed' | 'stopped';

export interface Preview {
  status: PreviewStatus;
  port: number | null;
  url: string | null;
  startedAt: string;
  /** The last part of the app's output, for showing why it failed. */
  log: string;
}

interface Entry extends Preview {
  child: ChildProcess | null;
}

const g = globalThis as typeof globalThis & { __makablPreviews?: Map<string, Entry> };
const previews = (g.__makablPreviews ??= new Map());

const LOG_CHARS = 4_000;
const READY_TIMEOUT_MS = 60_000;
const BUILD_TIMEOUT_MS = 600_000;

function childEnv(port: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'production', PORT: String(port), NEXT_TELEMETRY_DISABLED: '1' };
  for (const k of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) {
    if (process.env[k] !== undefined) env[k] = process.env[k];
  }
  return env;
}

/** A port nothing is listening on right now. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => (typeof addr === 'object' && addr ? resolve(addr.port) : reject(new Error('no port'))));
    });
  });
}

/** The Next.js CLI inside the generated project, if its dependencies are installed. */
function nextBin(dir: string): string | null {
  const bin = join(dir, 'node_modules', 'next', 'dist', 'bin', 'next');
  return existsSync(bin) ? bin : null;
}

const isBuilt = (dir: string) => existsSync(join(dir, '.next', 'BUILD_ID'));

function append(entry: Entry, chunk: Buffer | string) {
  entry.log = (entry.log + chunk.toString()).slice(-LOG_CHARS);
}

/** Run `next build` once if the project has no production build yet. */
function build(dir: string, bin: string, entry: Entry): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, 'build'], { cwd: dir, env: childEnv(0), windowsHide: true });
    entry.child = child;
    child.stdout.on('data', (d) => append(entry, d));
    child.stderr.on('data', (d) => append(entry, d));
    const timer = setTimeout(() => child.kill(), BUILD_TIMEOUT_MS);
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
    child.on('error', (err) => { clearTimeout(timer); append(entry, err.message); resolve(false); });
  });
}

async function waitUntilUp(url: string, entry: Entry): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (entry.status !== 'starting') return false;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.status < 500) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export function previewOf(key: string): Preview | null {
  const e = previews.get(key);
  if (!e) return null;
  const { child: _child, ...view } = e;
  return view;
}

/**
 * Start (or keep) the preview of the project in `dir`. Resolves once it is running or
 * has failed; call previewOf() for the outcome.
 */
export async function startPreview(key: string, dir: string): Promise<Preview> {
  const existing = previews.get(key);
  if (existing && ['building', 'starting', 'running'].includes(existing.status)) return previewOf(key)!;

  const entry: Entry = { status: 'building', port: null, url: null, startedAt: new Date().toISOString(), log: '', child: null };
  previews.set(key, entry);

  const bin = nextBin(dir);
  if (!bin) {
    entry.status = 'failed';
    entry.log = 'The project has no installed dependencies (node_modules/next is missing).';
    return previewOf(key)!;
  }
  if (!isBuilt(dir) && !(await build(dir, bin, entry))) {
    entry.status = 'failed';
    return previewOf(key)!;
  }
  if (entry.status !== 'building') return previewOf(key)!; // stopped meanwhile

  const port = await freePort();
  entry.port = port;
  entry.url = `http://localhost:${port}`;
  entry.status = 'starting';
  const child = spawn(process.execPath, [bin, 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: dir, env: childEnv(port), windowsHide: true,
  });
  entry.child = child;
  child.stdout.on('data', (d) => append(entry, d));
  child.stderr.on('data', (d) => append(entry, d));
  child.on('close', () => {
    if (entry.status === 'running' || entry.status === 'starting') entry.status = 'failed';
    entry.child = null;
  });

  if (await waitUntilUp(`http://127.0.0.1:${port}/`, entry)) entry.status = 'running';
  else if (entry.status === 'starting') { entry.status = 'failed'; child.kill(); }
  return previewOf(key)!;
}

export function stopPreview(key: string): void {
  const e = previews.get(key);
  if (!e) return;
  e.status = 'stopped';
  e.child?.kill();
  e.child = null;
}

/** Stop every preview when this server process exits, so none are left running. */
process.once('exit', () => { for (const e of previews.values()) e.child?.kill(); });

// ---- live view while the build runs --------------------------------------------------
//
// `next dev` on the project while the builder writes files, so the page can show the app
// taking shape (hot reload does the refreshing). It writes to its own folder
// (NEXT_DIST_DIR, set in the starter template's next.config.ts) so it cannot collide with
// the `next build` the checks run in the same directory. Same stripped environment and
// the same caveat as above: generated code running on this machine. It is stopped when
// the build ends; "Run the app" opens the finished production build.

const LIVE = ':live';
const LIVE_READY_TIMEOUT_MS = 120_000; // the first page compiles on demand

export const livePreviewOf = (key: string): Preview | null => previewOf(key + LIVE);

/** The template's config reads NEXT_DIST_DIR; older workspaces do not and would collide. */
function hasSeparateDistDir(dir: string): boolean {
  try {
    return readFileSync(join(dir, 'next.config.ts'), 'utf8').includes('NEXT_DIST_DIR');
  } catch {
    return false;
  }
}

/** Start the live view. Resolves when it is serving or has failed; never throws. */
export async function startLivePreview(key: string, dir: string): Promise<Preview> {
  const id = key + LIVE;
  const existing = previews.get(id);
  if (existing && ['starting', 'running'].includes(existing.status)) return previewOf(id)!;

  const entry: Entry = { status: 'starting', port: null, url: null, startedAt: new Date().toISOString(), log: '', child: null };
  previews.set(id, entry);

  const bin = nextBin(dir);
  if (!bin || !hasSeparateDistDir(dir)) {
    entry.status = 'failed';
    entry.log = !bin
      ? 'The project has no installed dependencies yet.'
      : 'This project predates the live view (its next.config.ts has no NEXT_DIST_DIR). New projects have it.';
    return previewOf(id)!;
  }

  const port = await freePort();
  entry.port = port;
  entry.url = `http://localhost:${port}`;
  const env: NodeJS.ProcessEnv = { ...childEnv(port), NODE_ENV: 'development', NEXT_DIST_DIR: '.next-dev' };
  const child = spawn(process.execPath, [bin, 'dev', '-p', String(port), '-H', '127.0.0.1'], { cwd: dir, env, windowsHide: true });
  entry.child = child;
  child.stdout.on('data', (d) => append(entry, d));
  child.stderr.on('data', (d) => append(entry, d));
  child.on('close', () => {
    if (entry.status === 'running' || entry.status === 'starting') entry.status = 'failed';
    entry.child = null;
  });

  const deadline = Date.now() + LIVE_READY_TIMEOUT_MS;
  let up = false;
  while (!up && Date.now() < deadline && entry.status === 'starting') {
    // Any response means it is serving; a half-written page may answer with an error, and that is what the viewer should see.
    try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(30_000) }); up = true; } catch { /* not up yet */ }
    if (!up) await new Promise((r) => setTimeout(r, 700));
  }
  if (up && entry.status === 'starting') entry.status = 'running';
  else if (entry.status === 'starting') { entry.status = 'failed'; child.kill(); }
  return previewOf(id)!;
}

export function stopLivePreview(key: string): void {
  const e = previews.get(key + LIVE);
  if (!e) return;
  e.status = 'stopped';
  e.child?.kill();
  e.child = null;
}
