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

/** "f-low-stock-dashboard-62f5e579" → "low-stock-dashboard": the readable part of a task id. */
const taskLabel = (id: string) => id.replace(/^f-/, '').replace(/-[0-9a-f]{8}$/, '');

function describe(e: FeedEvent): string {
  const p = e.payload;
  const task = e.taskId ? `${taskLabel(e.taskId)}: ` : '';
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

/** Colour for a feed line: green for passes, amber for pauses, red for failures. */
function toneOf(e: FeedEvent): string {
  switch (e.type) {
    case 'task_verified': case 'approval_decided': case 'task_resumed': return 't-good';
    case 'checks_run': case 'project_checks_run': return e.payload.passed ? 't-good' : 't-bad';
    case 'budget_blocked': case 'task_paused': case 'approval_requested': return 't-warn';
    case 'task_failed': case 'task_refused': case 'budget_overshoot': return 't-bad';
    case 'tool_executed': return e.payload.isError ? 't-bad' : 't-accent';
    default: return '';
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
    <section className="terminal" aria-label="Live feed">
      <div className="terminal-head">
        <div className="row" style={{ gap: 12 }}>
          <span className="dots" aria-hidden><span /><span /><span /></span>
          <span className="terminal-title">live feed · event log</span>
        </div>
        <span className="row small" style={{ gap: 8, color: connected ? '#4ade80' : '#8a97a8', fontFamily: 'var(--font-mono)' }}>
          {connected && <span className="live-dot" aria-hidden />}
          {connected ? 'live' : 'connecting'}
        </span>
      </div>
      {events.length === 0 ? (
        <div className="feed-empty">$ waiting for the first event…</div>
      ) : (
        <ul className="feed" aria-live="polite">
          {events.map((e) => (
            <li key={e.seq}>
              <span className="time">{new Date(e.at).toLocaleTimeString('en-GB', { hour12: false })}</span>
              <span className={toneOf(e)}>{describe(e)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
