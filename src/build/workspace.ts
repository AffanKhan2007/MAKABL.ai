import { spawn } from 'node:child_process';
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

// The project's working copy that the build loop edits (working model 2.2 rule 2, FR-18).
//
// Model-supplied paths are confined to the root: absolute paths, `..` escapes and
// symlinks are refused. The model cannot run commands; it can only trigger the checks
// the platform defines (see Verifier).
//
// NOT a sandbox. Checks run as local processes with a scrubbed environment and a
// timeout, but with no network, CPU or memory isolation (NFR-03 needs a container).
// Do not run untrusted generated code here outside development.

export const MAX_FILE_BYTES = 1_000_000;
const MAX_LIST_ENTRIES = 500;
const IGNORED_DIRS = new Set(['node_modules', '.git', '.next', 'dist']);

export class WorkspaceError extends Error {}

export interface CommandResult {
  exitCode: number | null;
  timedOut: boolean;
  /** Combined stdout and stderr, truncated to the last `maxOutput` characters. */
  output: string;
  durationMs: number;
}

export class Workspace {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  /** Resolve a model-supplied relative path inside the root, or throw. */
  async resolve(path: string): Promise<string> {
    if (typeof path !== 'string' || path.length === 0) throw new WorkspaceError('path is required');
    if (path.includes('\0')) throw new WorkspaceError('path contains a null byte');
    if (isAbsolute(path) || /^[a-zA-Z]:/.test(path)) throw new WorkspaceError('path must be relative to the project root');
    const full = resolve(this.root, path);
    if (full !== this.root && !full.startsWith(this.root + sep)) throw new WorkspaceError('path escapes the project root');
    // Refuse symlinks anywhere along the existing part of the path.
    let cur = this.root;
    for (const part of relative(this.root, full).split(sep).filter(Boolean)) {
      cur = join(cur, part);
      const st = await lstat(cur).catch(() => null);
      if (!st) break;
      if (st.isSymbolicLink()) throw new WorkspaceError(`${relative(this.root, cur)} is a symlink`);
    }
    return full;
  }

  async read(path: string): Promise<string> {
    const full = await this.resolve(path);
    const st = await lstat(full).catch(() => null);
    if (!st?.isFile()) throw new WorkspaceError(`${path} is not a file`);
    if (st.size > MAX_FILE_BYTES) throw new WorkspaceError(`${path} is larger than ${MAX_FILE_BYTES} bytes`);
    return readFile(full, 'utf8');
  }

  async write(path: string, content: string): Promise<void> {
    if (typeof content !== 'string') throw new WorkspaceError('content must be a string');
    if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new WorkspaceError(`content is larger than ${MAX_FILE_BYTES} bytes`);
    const full = await this.resolve(path);
    await mkdir(dirname(full), { recursive: true });
    // Re-check the real location after creating parents, in case a link appeared meanwhile.
    const realRoot = await realpath(this.root);
    const realParent = await realpath(dirname(full));
    if (realParent !== realRoot && !realParent.startsWith(realRoot + sep)) {
      throw new WorkspaceError('path escapes the project root');
    }
    await writeFile(full, content, 'utf8');
  }

  /** Files under `path` (relative, forward slashes), skipping dependency and build dirs. */
  async list(path = '.'): Promise<string[]> {
    const start = await this.resolve(path);
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (out.length >= MAX_LIST_ENTRIES) return;
        if (entry.isSymbolicLink()) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORED_DIRS.has(entry.name)) await walk(full);
        } else if (entry.isFile()) {
          out.push(relative(this.root, full).split(sep).join('/'));
        }
      }
    };
    await walk(start);
    return out.sort();
  }

  /**
   * Run a platform-defined command in the root. The environment is reduced to PATH and
   * a few basics, so no provider credentials reach generated code.
   */
  run(command: readonly string[], timeoutMs: number, maxOutput = 4_000): Promise<CommandResult> {
    const [cmd, ...args] = command;
    if (!cmd) throw new WorkspaceError('empty command');
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', CI: '1' };
    for (const k of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) {
      if (process.env[k] !== undefined) env[k] = process.env[k];
    }
    // On Windows npm and npx are .cmd scripts, which Node will only start through cmd.exe.
    // Commands come from platform check definitions, never from the model.
    const [file, argv] = process.platform === 'win32' && (cmd === 'npm' || cmd === 'npx')
      ? ['cmd.exe', ['/d', '/s', '/c', cmd, ...args]]
      : [cmd, args];
    const started = Date.now();
    return new Promise((done) => {
      let output = '';
      const child = spawn(file, argv, { cwd: this.root, env, shell: false, windowsHide: true });
      const keep = (chunk: Buffer) => { output = (output + chunk.toString('utf8')).slice(-maxOutput); };
      child.stdout.on('data', keep);
      child.stderr.on('data', keep);
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
      child.on('error', (err) => {
        clearTimeout(timer);
        done({ exitCode: null, timedOut, output: `${output}\n${err.message}`.slice(-maxOutput), durationMs: Date.now() - started });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        done({ exitCode: code, timedOut, output, durationMs: Date.now() - started });
      });
    });
  }
}
