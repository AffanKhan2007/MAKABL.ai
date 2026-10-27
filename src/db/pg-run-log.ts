import type pg from 'pg';
import type { CalibrationRun, FeatureType, RunLog } from '../calibration/runs.ts';
import { fromNumeric, toNumeric } from './money.ts';

// calibration_runs-backed RunLog. Runs hold token counts and costs only, no project
// content, and are pooled across tenants so every user's estimates improve.

interface RunRow {
  feature_type: FeatureType; model: string; calls: number; attempts: number;
  input_tokens: string; output_tokens: string; cache_write_5m_tokens: string;
  cache_write_1h_tokens: string; cache_read_tokens: string;
  cost: string; verified: boolean; probe_cost: string | null;
  quoted_low: string | null; quoted_high: string | null;
}

export class PgRunLog implements RunLog {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async record(r: CalibrationRun): Promise<void> {
    await this.pool.query(
      `insert into calibration_runs
         (feature_type, model, calls, attempts, input_tokens, output_tokens,
          cache_write_5m_tokens, cache_write_1h_tokens, cache_read_tokens,
          cost, currency, verified, probe_cost, quoted_low, quoted_high)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'USD', $11, $12, $13, $14)`,
      [
        r.featureType, r.model, r.calls, r.attempts, r.tokens.input, r.tokens.output,
        r.tokens.cacheWrite5m, r.tokens.cacheWrite1h, r.tokens.cacheRead,
        toNumeric(r.cost), r.verified,
        r.probeCost === undefined ? null : toNumeric(r.probeCost),
        r.quoted ? toNumeric(r.quoted.low) : null,
        r.quoted ? toNumeric(r.quoted.high) : null,
      ],
    );
  }

  async list(filter: { featureTypes?: FeatureType[] } = {}): Promise<CalibrationRun[]> {
    const { rows } = await this.pool.query<RunRow>(
      `select * from calibration_runs
        where $1::text[] is null or feature_type = any($1)
        order by created_at`,
      [filter.featureTypes ?? null],
    );
    return rows.map((r) => ({
      featureType: r.feature_type,
      model: r.model,
      calls: r.calls,
      attempts: r.attempts,
      tokens: {
        input: Number(r.input_tokens),
        output: Number(r.output_tokens),
        cacheWrite5m: Number(r.cache_write_5m_tokens),
        cacheWrite1h: Number(r.cache_write_1h_tokens),
        cacheRead: Number(r.cache_read_tokens),
      },
      cost: fromNumeric(r.cost),
      verified: r.verified,
      ...(r.probe_cost === null ? {} : { probeCost: fromNumeric(r.probe_cost) }),
      ...(r.quoted_low === null || r.quoted_high === null
        ? {}
        : { quoted: { low: fromNumeric(r.quoted_low), high: fromNumeric(r.quoted_high) } }),
    }));
  }
}
