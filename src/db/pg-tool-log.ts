import type pg from 'pg';
import type { ToolLog, ToolResultRecord } from '../build/tool-log.ts';
import { withTx, type DbScope } from './scope.ts';

// build_tool_results-backed ToolLog for one project, so a paused build can be resumed
// after the server restarts and still replay the exact history the model saw.

export class PgToolLog implements ToolLog {
  private readonly pool: pg.Pool;
  private readonly projectId: string;
  private readonly scope: DbScope;

  constructor(pool: pg.Pool, projectId: string, scope: DbScope = {}) {
    this.pool = pool;
    this.projectId = projectId;
    this.scope = scope;
  }

  get(key: string): Promise<ToolResultRecord | undefined> {
    return withTx(this.pool, this.scope, async (c) => {
      const { rows } = await c.query<{ content: string; is_error: boolean }>(
        'select content, is_error from build_tool_results where project_id = $1 and step_key = $2',
        [this.projectId, key]);
      return rows[0] ? { content: rows[0].content, isError: rows[0].is_error } : undefined;
    });
  }

  put(key: string, record: ToolResultRecord): Promise<void> {
    return withTx(this.pool, this.scope, async (c) => {
      // First write wins: a replay must never overwrite what the model already saw.
      await c.query(
        `insert into build_tool_results (project_id, step_key, content, is_error)
         values ($1, $2, $3, $4) on conflict (project_id, step_key) do nothing`,
        [this.projectId, key, record.content, record.isError]);
    });
  }
}
