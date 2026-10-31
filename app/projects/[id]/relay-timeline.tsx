import type { CSSProperties } from 'react';
import type { Phase } from '../../../src/estimator/estimator.ts';
import type { ActivityEvent } from '../../../src/events/event-store.ts';
import { phaseOfTask } from '../../../src/relay/relay.ts';
import type { PhaseBudget } from '../../../src/relay/negotiator.ts';
import { money } from '../../format.ts';

// Relay timeline (#19): one column per phase with the model that ran it, what it spent
// against its allowance, the briefs passed between phases, the negotiator's decisions and
// the reviews. Everything comes from the event log and the ledger; nothing is estimated
// here except the plan figures shown before the build starts.

const PHASES: Phase[] = ['spec', 'architect', 'build', 'review'];
const NAME: Record<Phase, { pro: string; easy: string }> = {
  spec: { pro: 'Spec', easy: 'Understanding your idea' },
  architect: { pro: 'Architect', easy: 'Planning the app' },
  build: { pro: 'Build', easy: 'Building it' },
  review: { pro: 'Review', easy: 'Double-checking' },
};
const OUTCOME_TONE: Record<string, string> = { granted: 'good', reassigned: 'accent', escalated: 'warn', returned: '' };

interface Props {
  events: ActivityEvent[];
  ledger: Array<{ taskId: string; amount: number }>;
  planned: Record<Phase, string>;
  estimate: Partial<Record<Phase, number>>;
  label: (id: string) => string;
  easy: boolean;
  /** Whether a build is running now; a started phase that is not running has stopped. */
  running: boolean;
}

const tokensK = (n: number) => `${(n / 1000).toFixed(1)}K`;
/** Relay phases often cost fractions of a cent; show enough digits to see them. */
const fine = (micros: number) => (micros > 0 && micros < 10_000 ? `$${(micros / 1_000_000).toFixed(4)}` : money(micros));
const p = (e: ActivityEvent) => e.payload as Record<string, any>;

export function RelayTimeline({ events, ledger, planned, estimate, label, easy, running }: Props) {
  // Events of the latest relay run only (keys carry the spec version).
  const relayEvents = events.filter((e) => typeof e.payload.key === 'string' && /^v\d+:/.test(String(e.payload.key)));
  const latest = relayEvents.reduce((v, e) => Math.max(v, Number(/^v(\d+):/.exec(String(e.payload.key))![1])), 0);
  const run = relayEvents.filter((e) => String(e.payload.key).startsWith(`v${latest}:`));
  const of = (type: string) => run.filter((e) => e.type === type);

  const started = new Map(of('relay_phase_started').map((e) => [p(e).phase as Phase, p(e)]));
  const finished = new Map(of('relay_phase_finished').map((e) => [p(e).phase as Phase, p(e)]));
  const substituted = new Map(of('relay_substituted').map((e) => [p(e).phase as Phase, p(e)]));
  const handoffs = of('relay_handoff').map(p);
  const negotiations = of('negotiation').map(p);
  const reviews = of('relay_review').map(p);
  const budgetEvent = of('relay_budget')[0];
  // The latest snapshot: after the last decision, or the opening allowances.
  const snapshot: { phases: PhaseBudget[]; slack: number } | null =
    negotiations.length ? negotiations[negotiations.length - 1]!.after : budgetEvent ? p(budgetEvent) as never : null;
  const allowance = new Map(snapshot?.phases.map((b) => [b.phase, b.allowance]) ?? []);
  // Each decision records the allowances after it; the ones before it are the previous
  // snapshot (or the opening allowances), so before → after needs nothing new from the log.
  type Snap = { phases: PhaseBudget[]; slack: number };
  const opening: Snap | null = budgetEvent ? (p(budgetEvent) as unknown as Snap) : null;
  const beforeOf = (i: number): Snap | null => (i === 0 ? opening : (negotiations[i - 1]!.after as Snap));
  const allowanceIn = (snap: Snap | null, phase: string) => snap?.phases.find((b) => b.phase === phase)?.allowance;
  const totalTokens = PHASES.reduce((t, ph) => {
    const tk = finished.get(ph)?.tokens as { input?: number; output?: number } | undefined;
    return t + Number(tk?.input ?? 0) + Number(tk?.output ?? 0);
  }, 0);

  const spent = new Map<Phase, number>();
  for (const l of ledger) {
    if (l.taskId.startsWith('design:')) continue; // mockups are paid from the cap but are not a relay phase
    spent.set(phaseOfTask(l.taskId), (spent.get(phaseOfTask(l.taskId)) ?? 0) + l.amount);
  }
  const hasRun = run.length > 0;
  const savedTokens = handoffs.reduce((t, h) => t + Math.max(0, Number(h.historyTokens) - Number(h.briefTokens)), 0);

  const status = (phase: Phase) =>
    finished.has(phase) ? 'done' : started.has(phase) ? (running ? 'running' : 'stopped') : 'waiting';

  return (
    <section className="card stack relay-timeline">
      <div className="row spread">
        <div>
          <span className="eyebrow">{easy ? 'Who is working on it' : 'Model relay · live'}</span>
          <h2 style={{ margin: '4px 0 0' }}>{easy ? 'Four AI helpers, one after another' : 'Relay timeline'}</h2>
        </div>
        {!easy && hasRun && (savedTokens > 0 || totalTokens > 0) && (
          <div className="row" style={{ gap: 6 }}>
            {totalTokens > 0 && <span className="badge">{tokensK(totalTokens)} tokens used</span>}
            {savedTokens > 0 && <span className="badge good">briefs carried {tokensK(savedTokens)} fewer tokens</span>}
          </div>
        )}
      </div>
      {!hasRun && (
        <p className="muted small" style={{ margin: 0 }}>
          {easy ? 'This starts when you start the build.' : 'Starts with the build. Planned models and estimates below; allowances are set from the cap when it starts.'}
        </p>
      )}

      <ol className="relay-track">
        {PHASES.map((phase) => {
          const s = status(phase);
          const model = String(started.get(phase)?.model ?? planned[phase]);
          const sub = substituted.get(phase);
          const used = spent.get(phase) ?? 0;
          const allow = allowance.get(phase);
          return (
            <li key={phase} className={`relay-step-card s-${s}`}>
              <div className="row spread" style={{ gap: 6 }}>
                <span className="relay-step">{easy ? NAME[phase].easy : NAME[phase].pro}</span>
                <span className={`badge ${s === 'done' ? 'good' : s === 'running' ? 'warn' : s === 'stopped' ? 'bad' : ''}`}>{s}</span>
              </div>
              <div className="relay-model">{label(model)}</div>
              {sub && (
                <div className="small" style={{ color: 'var(--warn)' }}>
                  {easy ? 'Using a stand-in AI' : `Planned ${label(String(sub.planned))}; ${String(sub.reason)}`}
                </div>
              )}
              {!easy && (
                hasRun && allow !== undefined ? (
                  <div>
                    <div className="row spread small num"><span className="muted">spent</span><span>{fine(used)} / {fine(allow)}</span></div>
                    <div className="bar meter"><span style={{ '--fill': Math.min(1, allow ? used / allow : 0) } as CSSProperties} /></div>
                  </div>
                ) : (
                  <div className="row spread small num"><span className="muted">estimate</span><span>{fine(estimate[phase] ?? 0)}</span></div>
                )
              )}
              {!easy && (() => {
                const tk = finished.get(phase)?.tokens as { input?: number; output?: number; calls?: number } | undefined;
                return tk ? (
                  <div className="small num" title="Tokens read / written by this phase's model">
                    <span className="muted">tokens </span>
                    {tokensK(Number(tk.input ?? 0))} in · {tokensK(Number(tk.output ?? 0))} out
                    {tk.calls && tk.calls > 1 ? <span className="muted"> · {tk.calls} calls</span> : null}
                  </div>
                ) : null;
              })()}
            </li>
          );
        })}
      </ol>

      {!easy && handoffs.length > 0 && (
        <div className="stack">
          <h3 style={{ margin: 0 }}>Handoff briefs</h3>
          {handoffs.map((h) => {
            const history = Number(h.historyTokens);
            const brief = Number(h.briefTokens);
            const cut = history > 0 ? Math.round((1 - brief / history) * 100) : 0;
            return (
              <details key={String(h.key)} className="handoff-detail">
                <summary className="small">
                  <strong>{NAME[h.from as Phase].pro} → {NAME[h.to as Phase].pro}</strong>
                  {h.feature ? ` · ${String(h.feature)}` : ''}
                  <span className="muted num"> · {tokensK(history)} history → {tokensK(brief)} brief{cut > 0 ? ` (−${cut}%)` : ''}</span>
                </summary>
                <pre className="mono small brief">{String(h.brief)}</pre>
              </details>
            );
          })}
        </div>
      )}

      {!easy && (negotiations.length > 0 || snapshot) && (
        <div className="stack">
          <div className="row spread">
            <h3 style={{ margin: 0 }}>Token negotiator</h3>
            {snapshot && <span className="muted small num">slack {money(snapshot.slack)}</span>}
          </div>
          {negotiations.length === 0
            ? <p className="muted small" style={{ margin: 0 }}>Every phase has stayed inside its allowance so far.</p>
            : (
              <ul className="negotiations">
                {negotiations.map((d, i) => {
                  const before = beforeOf(i);
                  const after = d.after as Snap | undefined;
                  const moved = [d.phase, ...(d.from ? [d.from] : [])] as string[];
                  return (
                    <li key={String(d.key)} className="negotiation">
                      <div>
                        <span className={`badge ${OUTCOME_TONE[String(d.outcome)] ?? ''}`}>{String(d.outcome)}</span>{' '}
                        <span className="small">
                          <strong>{NAME[d.phase as Phase].pro}</strong> {fine(Number(d.amount))}
                          {d.outcome === 'reassigned' && d.from ? ` from ${NAME[d.from as Phase].pro}` : ''}
                          {d.outcome === 'escalated' ? ' (the Budget Gate decides)' : ''}
                          <span className="muted"> · {String(d.reason)}</span>
                        </span>
                      </div>
                      {before && after && (
                        <div className="before-after small num" aria-label="Allowances before and after this decision">
                          {moved.map((ph) => {
                            const b = allowanceIn(before, ph);
                            const a = allowanceIn(after, ph);
                            if (b === undefined || a === undefined) return null;
                            return (
                              <span key={ph}>
                                <span className="muted">{NAME[ph as Phase].pro}</span> {fine(b)} → <strong className={a > b ? 't-up' : a < b ? 't-down' : ''}>{fine(a)}</strong>
                              </span>
                            );
                          })}
                          {before.slack !== after.slack && (
                            <span><span className="muted">slack</span> {fine(before.slack)} → <strong className={after.slack > before.slack ? 't-up' : 't-down'}>{fine(after.slack)}</strong></span>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
        </div>
      )}

      {reviews.length > 0 && (
        <div className="stack">
          <h3 style={{ margin: 0 }}>{easy ? 'What the checker said' : 'Reviews'}</h3>
          {reviews.map((r) => (
            <details key={String(r.key)} className="handoff-detail">
              <summary className="small">
                <span className={`badge ${r.verdict === 'approve' ? 'good' : r.verdict === 'concerns' ? 'warn' : ''}`}>
                  {r.verdict === 'approve' ? 'looks right' : r.verdict === 'concerns' ? 'concerns' : 'no verdict'}
                </span>{' '}
                <strong>{String(r.feature)}</strong>
                {!easy && <span className="muted"> · {label(String(r.model))}</span>}
              </summary>
              <pre className="mono small brief">{String(r.review)}</pre>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
