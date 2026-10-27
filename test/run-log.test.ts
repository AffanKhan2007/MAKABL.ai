import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { MemoryRunLog, type CalibrationRun, type RunLog } from '../src/calibration/runs.ts';
import { PgRunLog } from '../src/db/pg-run-log.ts';
import { usd } from '../src/domain/types.ts';
import { DATABASE_URL } from './support/envs.ts';

const pool = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000 });
const pgReady = await pool.query('select 1 from calibration_runs limit 1').then(() => true, () => false);
if (!pgReady) await pool.end();

const logs: Array<{ name: string; make: () => RunLog; skip: string | false }> = [
  { name: 'memory', make: () => new MemoryRunLog(), skip: false },
  { name: 'postgres', make: () => new PgRunLog(pool), skip: pgReady ? false : 'no database with calibration_runs' },
];

const tag = `t${Date.now()}`;
const full: CalibrationRun = {
  featureType: 'integration', model: `anthropic/${tag}`, calls: 9, attempts: 2, verified: false,
  tokens: { input: 1_234, output: 5_678, cacheWrite5m: 90_000, cacheWrite1h: 10_000, cacheRead: 300_000 },
  cost: usd(1.234567), probeCost: usd(0.042), quoted: { low: usd(0.5), high: usd(3) },
};
const minimal: CalibrationRun = {
  featureType: 'page', model: `anthropic/${tag}`, calls: 1, attempts: 1, verified: true,
  tokens: { input: 1, output: 2, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 },
  cost: usd(0.000001),
};

for (const { name, make, skip } of logs) {
  describe(`RunLog (${name})`, { skip }, () => {
    if (skip) return;
    if (name === 'postgres') after(() => pool.end());

    test('round-trips every field, including optional ones, exactly', async () => {
      const log = make();
      await log.record(full);
      await log.record(minimal);
      const mine = (await log.list()).filter((r) => r.model === `anthropic/${tag}`);
      assert.deepEqual(mine, [full, minimal]);
    });

    test('filters by feature type', async () => {
      const log = make();
      await log.record(full);
      const pages = (await log.list({ featureTypes: ['page'] })).filter((r) => r.model === `anthropic/${tag}`);
      assert.ok(pages.every((r) => r.featureType === 'page'));
    });
  });
}

test('calibration runs cannot be edited or deleted once written', { skip: pgReady ? false : 'no database' }, async () => {
  const p = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    await assert.rejects(p.query(`update calibration_runs set cost = 0 where model = $1`, [`anthropic/${tag}`]), /append-only/);
    await assert.rejects(p.query(`delete from calibration_runs where model = $1`, [`anthropic/${tag}`]), /append-only/);
  } finally {
    await p.end();
  }
});
