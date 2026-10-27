// Docker-free local Postgres 17 on the same port and credentials as docker-compose.yml.
// Uses the official server binaries from the embedded-postgres package; data and the
// server log live in .pgdata/.
//
//   node scripts/pg-local.ts start | stop | status
//
// The server is started with pg_ctl, which detaches it, so it keeps running after this
// script (or the terminal or session that ran it) exits. Stop it with `stop`.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const DATA_DIR = '.pgdata';
const PORT = 5433;
const USER = 'postgres';
const PASSWORD = 'makabl';
const DATABASE = 'makabl';

// embedded-postgres installs one binary package per platform, e.g. @embedded-postgres/windows-x64.
const os = process.platform === 'win32' ? 'windows' : process.platform;
const { pg_ctl: pgCtl } = (await import(`@embedded-postgres/${os}-${process.arch}`)) as { pg_ctl: string };

function ctl(...args: string[]): string {
  return execFileSync(pgCtl, ['-D', DATA_DIR, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * `pg_ctl start` must not get our pipes: the server it spawns inherits them and holds
 * them open, so execFileSync would wait for as long as the server runs. Its output
 * goes to the -l log file instead.
 */
function ctlStart(...args: string[]): void {
  execFileSync(pgCtl, ['-D', DATA_DIR, 'start', ...args], { stdio: 'ignore' });
}

function running(): boolean {
  try {
    ctl('status');
    return true;
  } catch {
    return false;          // pg_ctl status exits 3 when the server is not running
  }
}

async function start(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    // First run: let embedded-postgres run initdb with the right user and password.
    await new EmbeddedPostgres({
      databaseDir: DATA_DIR, port: PORT, user: USER, password: PASSWORD, persistent: true, onLog: () => {},
    }).initialise();
  }
  if (running()) {
    console.log('already running');
  } else {
    // -w waits until the server accepts connections. A stale postmaster.pid from a killed
    // server is detected and replaced by postgres itself.
    try {
      ctlStart('-w', '-t', '120', '-l', join(DATA_DIR, 'server.log'), '-o', `-p ${PORT}`);
    } catch {
      throw new Error(`postgres did not start; see ${join(DATA_DIR, 'server.log')}`);
    }
  }

  const admin = new pg.Client({ host: 'localhost', port: PORT, user: USER, password: PASSWORD, database: 'postgres' });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [DATABASE]);
    if (rowCount === 0) await admin.query(`create database ${DATABASE}`);
  } finally {
    await admin.end();
  }
  console.log(`postgres 17 ready on postgres://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASE}`);
}

const command = process.argv[2] ?? 'start';
switch (command) {
  case 'start':
    await start();
    break;
  case 'stop':
    if (running()) ctl('stop', '-m', 'fast', '-w');
    console.log('stopped');
    break;
  case 'status':
    console.log(running() ? `running on port ${PORT}` : 'not running');
    break;
  default:
    console.error(`unknown command "${command}"; use start, stop or status`);
    process.exit(2);
}
