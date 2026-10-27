// Append-only event log (rule 5, FR-27). The feed reads only from here; model text can
// annotate an event but never create one. MemoryEventLog for tests and the demo,
// PgEventLog (src/db/pg-event-log.ts) for the activity_events table.

export type EventType =
  | 'budget_reserved' | 'budget_settled' | 'budget_released' | 'budget_blocked'
  | 'budget_overshoot' | 'approval_requested' | 'approval_decided' | 'idempotent_replay'
  | 'task_paused' | 'task_resumed'
  | 'task_started' | 'attempt_started' | 'tool_executed' | 'checks_run'
  | 'task_verified' | 'task_failed' | 'task_refused' | 'calibration_recorded'
  | 'workspace_ready' | 'build_mode_changed';

export interface ActivityEvent {
  seq: number;
  projectId: string;
  taskId: string | null;
  type: EventType;
  payload: Record<string, unknown>;
  annotation?: string;
  at: string;
}

export type NewEvent = Omit<ActivityEvent, 'seq' | 'at'>;
export type Listener = (e: ActivityEvent) => void;

export interface EventLog {
  append(e: NewEvent): Promise<ActivityEvent>;
  list(projectId: string): Promise<ActivityEvent[]>;
  /** Resolves once the subscription is live; returns an unsubscribe function. */
  subscribe(l: Listener, filter?: { projectId?: string }): Promise<() => Promise<void>>;
}

export class MemoryEventLog implements EventLog {
  private readonly events: ActivityEvent[] = [];
  private readonly listeners = new Set<Listener>();
  private seq = 0;

  async append(e: NewEvent): Promise<ActivityEvent> {
    return this.commit([e])[0]!;
  }

  /** Publish a batch at once; MemoryGateStore calls this when a transaction commits. */
  commit(batch: NewEvent[]): ActivityEvent[] {
    const out = batch.map((e) => Object.freeze({ ...e, seq: ++this.seq, at: new Date().toISOString() }));
    this.events.push(...out);
    for (const e of out) for (const l of this.listeners) l(e);
    return out;
  }

  async list(projectId: string): Promise<ActivityEvent[]> {
    return this.events.filter((e) => e.projectId === projectId);
  }

  async subscribe(l: Listener, filter: { projectId?: string } = {}): Promise<() => Promise<void>> {
    const wrapped: Listener = (e) => {
      if (!filter.projectId || e.projectId === filter.projectId) l(e);
    };
    this.listeners.add(wrapped);
    return async () => { this.listeners.delete(wrapped); };
  }
}
