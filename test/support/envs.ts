import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PgEventLog } from '../../src/db/pg-event-log.ts';
import { PgGateStore } from '../../src/db/pg-gate-store.ts';
import { MemoryEventLog, type EventLog } from '../../src/events/event-store.ts';
import { BudgetGate } from '../../src/gate/budget-gate.ts';
import { MemoryGateStore } from '../../src/gate/memory-store.ts';

/**
 * Tests use their own database, never the app's: they write calibration runs, and the
 * app's estimates must only ever learn from real builds. Create it with
 * `npm run db:reset:test`; Postgres tests skip themselves if it is missing.
 */
export const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:makabl@localhost:5433/makabl_test';
export const NOW = () => new Date('2026-10-24T00:00:00Z');

export interface GateEnv {
  name: string;
  /** A fresh project id (with its rows, for Postgres) per call. */
  newProject(): Promise<string>;
  gate: BudgetGate;
  events: EventLog;
  close(): Promise<void>;
}

export function memoryEnv(): GateEnv {
  const events = new MemoryEventLog();
  return {
    name: 'memory',
    newProject: async () => `proj_${randomUUID()}`,
    gate: new BudgetGate(new MemoryGateStore(events), NOW),
    events,
    close: async () => {},
  };
}

/** Returns null when no schema-applied database is reachable, so the suite can skip. */
export async function pgEnv(): Promise<GateEnv | null> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10, connectionTimeoutMillis: 2000 });
  try {
    await pool.query('select 1 from reservations limit 1');
  } catch {
    await pool.end();
    return null;
  }
  return {
    name: 'postgres',
    newProject: () => createProject(pool),
    gate: new BudgetGate(new PgGateStore(pool), NOW),
    events: new PgEventLog(pool),
    close: () => pool.end(),
  };
}

export async function createProject(pool: pg.Pool, ownerId?: string): Promise<string> {
  const owner = ownerId ?? (await pool.query<{ id: string }>(
    'insert into users (email) values ($1) returning id', [`${randomUUID()}@test.local`])).rows[0]!.id;
  const { rows } = await pool.query<{ id: string }>(
    'insert into projects (owner_id, name) values ($1, $2) returning id', [owner, 'test project']);
  return rows[0]!.id;
}
