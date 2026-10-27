'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { money } from '../../format.ts';

// Live feed (FR-27). Every line comes from the activity_events table via server-sent
// events; nothing here is model narration.

interface FeedEvent {
  seq: number;
  taskId: string | null;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

/** Events that change what the rest of the page shows. */
const REFRESH_ON = new Set([
  'task_paused', 'task_resumed', 'task_verified', 'task_failed', 'task_refused',
  'approval_requested', 'approval_decided', 'budget_settled', 'build_mode_changed',
  'checks_run', 'project_checks_run',
]);

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

function describe(e: FeedEvent): string {
  const p = e.payload;
  const task = e.taskId ? `${e.taskId}: ` : '';
  switch (e.type) {
    case 'task_started': return `${task}started "${p.feature}" (${p.featureType})`;
    case 'attempt_started': return `${task}attempt ${p.attempt}`;
    case 'budget_reserved': return `${task}reserved ${money(num(p.worstCase))} (worst case)`;
    case 'budget_settled': return `${task}model call cost ${money(num(p.observed))}`;
    case 'budget_overshoot': return `${task}call cost ${money(num(p.by))} more than reserved`;
    case 'budget_blocked': return `${task}blocked: ${p.check} would be exceeded (${money(num(p.used))} committed + ${money(num(p.worstCase))} > ${money(num(p.cap))})`;
    case 'task_paused': return `${task}paused, waiting for your approval`;
    case 'approval_requested': return `approval requested: ${p.reason}`;
    case 'approval_decided': return `approval ${p.decision}${num(p.raiseBy) ? `, caps raised by ${money(num(p.raiseBy))}` : ''}`;
    case 'task_resumed': return `${task}resumed`;
    case 'idempotent_replay': return `${task}replayed an earlier step (no charge)`;
    case 'tool_executed': return `${task}${p.tool}${p.path ? ` ${p.path}` : ''}${p.isError ? ' (error)' : ''}`;
    case 'checks_run': return `${task}checks ${p.passed ? 'passed' : 'failed'}`;
    case 'task_verified': return `${task}verified after ${p.attempts} attempt(s)`;
    case 'task_failed': return `${task}failed: ${p.reason}`;
    case 'task_refused': return `${task}the model declined the request`;
    case 'calibration_recorded': return `${task}run recorded: ${money(num(p.cost))} over ${p.calls} calls`;
    case 'workspace_ready': return `project prepared${p.templateWritten ? ' from the starter template' : ''}; dependencies installed in ${p.seconds}s (exit ${p.installExit})`;
    case 'build_mode_changed': return `build mode set to ${p.mode}`;
    case 'spec_changed': return `spec changed to v${p.toVersion}; plan needs approval again`;
    case 'project_checks_run': return `whole-project checks ${p.passed ? 'passed' : 'failed'}`;
    default: return `${task}${e.type}`;
  }
}

export function Feed({ projectId }: { projectId: string }) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const router = useRouter();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const source = new EventSource(`/api/projects/${projectId}/events`);
    let historyDone = false;
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener('history-done', () => { historyDone = true; });
    source.onmessage = (msg) => {
      const e = JSON.parse(msg.data) as FeedEvent;
      setEvents((prev) => (prev.some((x) => x.seq === e.seq) ? prev : [e, ...prev]));
      if (historyDone && REFRESH_ON.has(e.type)) {
        // Coalesce bursts of events into one refresh of the server-rendered parts.
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => router.refresh(), 250);
      }
    };
    return () => {
      source.close();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [projectId, router]);

  return (
    <section className="card">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>Live feed</h2>
        <span className={`badge ${connected ? 'good' : ''}`}>{connected ? 'Live' : 'Connecting'}</span>
      </div>
      <p className="muted small">Read from the event log. Newest first.</p>
      {events.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>Nothing has happened yet.</p>
      ) : (
        <ul className="feed" aria-live="polite">
          {events.map((e) => (
            <li key={e.seq}>
              <span className="time">{new Date(e.at).toLocaleTimeString('en-GB', { hour12: false })}</span>
              <span>{describe(e)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
