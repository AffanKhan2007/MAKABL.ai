import pg from 'pg';
import type { ActivityEvent, EventLog, Listener, NewEvent } from '../events/event-store.ts';

// activity_events-backed EventLog. Subscribers use LISTEN on a dedicated connection; the
// table's trigger NOTIFYs on commit, so a rolled-back Gate transaction never shows up.
//
// NOTIFY ignores row-level security: every listener receives every project's events.
// Pass projectId to subscribe(), and never forward unfiltered events to a browser.

interface EventRow {
  seq: string | number; project_id: string; task_id: string | null;
  type: ActivityEvent['type']; payload: Record<string, unknown>;
  annotation: string | null; created_at: string | Date;
}

const toEvent = (r: EventRow): ActivityEvent => ({
  seq: Number(r.seq),
  projectId: r.project_id,
  taskId: r.task_id,
  type: r.type,
  payload: r.payload,
  ...(r.annotation === null ? {} : { annotation: r.annotation }),
  at: new Date(r.created_at).toISOString(),
});

export class PgEventLog implements EventLog {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async append(e: NewEvent): Promise<ActivityEvent> {
    const { rows } = await this.pool.query<EventRow>(
      `insert into activity_events (project_id, task_id, type, payload, annotation)
       values ($1, $2, $3, $4, $5) returning *`,
      [e.projectId, e.taskId, e.type, JSON.stringify(e.payload), e.annotation ?? null]);
    return toEvent(rows[0]!);
  }

  async list(projectId: string): Promise<ActivityEvent[]> {
    const { rows } = await this.pool.query<EventRow>(
      'select * from activity_events where project_id = $1 order by seq', [projectId]);
    return rows.map(toEvent);
  }

  async subscribe(l: Listener, filter: { projectId?: string } = {}): Promise<() => Promise<void>> {
    // A dedicated client: LISTEN is per connection and must not go back into the pool.
    const client = new pg.Client(this.pool.options);
    await client.connect();
    client.on('notification', (msg) => {
      if (msg.channel !== 'activity_events' || !msg.payload) return;
      const e = toEvent(JSON.parse(msg.payload) as EventRow);
      if (filter.projectId && e.projectId !== filter.projectId) return;
      l(e);
    });
    await client.query('listen activity_events');
    return async () => {
      await client.query('unlisten activity_events');
      await client.end();
    };
  }
}
