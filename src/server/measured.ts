import { withTx } from '../db/scope.ts';
import { aggregateMeasured } from '../estimator/measured.ts';
import { db } from './db.ts';
import { userScope } from './session.ts';

/** What this user's past builds measured for each relay phase (row-level security applies). */
export async function measuredPhases() {
  const rows = await withTx(db(), await userScope(), async (c) => {
    const { rows } = await c.query<{ payload: Record<string, unknown> }>(
      `select payload from activity_events where type = 'relay_phase_finished'`);
    return rows;
  });
  return aggregateMeasured(rows.map((r) => r.payload));
}
