import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PgEventLog } from '../../../../src/db/pg-event-log.ts';
import { wireframeOf } from '../../../../src/relay/render.ts';
import { db } from '../../../../src/server/db.ts';
import { getMode } from '../../../../src/server/mode.ts';
import { modelLabel } from '../../../../src/server/plan.ts';
import { listRenders } from '../../../../src/server/renders.ts';
import { getProject } from '../../../../src/server/projects.ts';
import { userScope } from '../../../../src/server/session.ts';
import { money } from '../../../format.ts';
import { requestRenderAction } from './actions.ts';
import { RenderStudio } from './render-studio.tsx';

export const dynamic = 'force-dynamic';

const PHASE_NAME: Record<string, string> = { spec: 'Spec', architect: 'Architect', build: 'Build', review: 'Review' };
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
const fine = (micros: number) => (micros > 0 && micros < 10_000 ? `$${(micros / 1_000_000).toFixed(4)}` : money(micros));

interface Allowance { phase: string; allowance: number }

export default async function RendersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();
  const easy = (await getMode()) === 'easy';

  const events = await new PgEventLog(db(), await userScope()).list(id);
  const renders = await listRenders(id);
  const handoff = [...events].reverse().find((e) => e.type === 'relay_handoff' && e.payload.from === 'architect');
  const wireframe = handoff ? wireframeOf(String(handoff.payload.brief ?? '')) : undefined;
  const negotiations = events.filter((e) => e.type === 'negotiation');
  const finished = events.filter((e) => e.type === 'relay_phase_finished');
  const allow = (snap: unknown): Map<string, number> =>
    new Map(((snap as { phases?: Allowance[] } | undefined)?.phases ?? []).map((p) => [p.phase, p.allowance]));

  // Token use per phase: the last "finished" record of each phase carries what it used.
  const usage = new Map<string, { input: number; output: number; calls: number; spent: number; model: string }>();
  for (const e of finished) {
    const u = (e.payload.usage ?? e.payload.tokens ?? {}) as { input?: number; output?: number; calls?: number };
    usage.set(String(e.payload.phase), {
      input: u.input ?? 0, output: u.output ?? 0, calls: u.calls ?? 0, spent: Number(e.payload.spent ?? 0), model: String(e.payload.model),
    });
  }
  const renderTokens = renders.reduce((t, r) => ({ input: t.input + r.tokens.input, output: t.output + r.tokens.output, cost: t.cost + r.cost }), { input: 0, output: 0, cost: 0 });

  return (
    <main className="renders-page">
      <p className="small" style={{ margin: '0 0 10px' }}><Link href={`/projects/${id}`}>← {project.name}</Link></p>
      <span className="eyebrow">{easy ? 'How it will look' : 'Wireframe · renders'}</span>
      <h1 style={{ marginTop: 8 }}>{easy ? 'See your app before it is built' : 'Wireframe and renders'}</h1>
      <p className="sub">
        {easy
          ? 'The AI draws what your pages will look like. Don’t like it? Say what to change and it draws it again.'
          : 'A model draws each page as a mockup. Ask for changes in words; every version is kept with its cost and tokens.'}
      </p>

      <RenderStudio projectId={id} renders={renders} action={requestRenderAction.bind(null, id)}
        pages={project.spec.features.map((f) => f.name)} easy={easy}
        labels={Object.fromEntries(renders.map((r) => [r.model, modelLabel(r.model)]))} />

      <section className="card stack">
        <h2 style={{ margin: 0 }}>{easy ? 'The plan for the layout' : 'Wireframe'}</h2>
        {wireframe
          ? <pre className="mono small wireframe">{wireframe.replace(/^##\s*Wireframe\s*/i, '')}</pre>
          : <p className="muted small" style={{ margin: 0 }}>
            The architect draws a text wireframe when a build starts. Until then, renders are drawn from your description and features.
          </p>}
      </section>

      {!easy && (
        <>
          <section className="card stack">
            <h2 style={{ margin: 0 }}>How the budget moved</h2>
            <p className="muted small" style={{ margin: 0 }}>
              The negotiator splits your cap between the phases, then grants, moves or hands back allowance as they work. Before and after, per decision.
            </p>
            {negotiations.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>No negotiation yet: it starts when a build does.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Decision</th><th>Why</th><th className="r">Before</th><th className="r">After</th></tr></thead>
                  <tbody>
                    {negotiations.map((e) => {
                      const p = e.payload as Record<string, unknown>;
                      const after = allow(p.after);
                      const before = allow(p.before);
                      // Runs made before "before" was recorded: where the arithmetic is certain, rebuild it.
                      const ph = String(p.phase), amount = Number(p.amount);
                      if (before.size === 0 && after.has(ph)) {
                        if (p.outcome === 'returned') before.set(ph, after.get(ph)! + amount);
                        if (p.outcome === 'granted') before.set(ph, after.get(ph)! - amount);
                      }
                      const phases = [...new Set([String(p.phase), ...(p.from ? [String(p.from)] : [])])];
                      return (
                        <tr key={e.seq}>
                          <td><span className={`badge ${p.outcome === 'escalated' ? 'warn' : p.outcome === 'returned' ? '' : 'accent'}`}>{String(p.outcome)}</span>{' '}
                            <strong>{PHASE_NAME[String(p.phase)] ?? String(p.phase)}</strong> {fine(Number(p.amount))}
                            {p.from ? <span className="muted"> from {PHASE_NAME[String(p.from)]}</span> : null}</td>
                          <td className="small muted">{String(p.reason)}</td>
                          <td className="r num small">{phases.map((ph) => <div key={ph}>{PHASE_NAME[ph]} {before.has(ph) ? fine(before.get(ph)!) : '—'}</div>)}</td>
                          <td className="r num small">{phases.map((ph) => <div key={ph}>{PHASE_NAME[ph]} {after.has(ph) ? fine(after.get(ph)!) : '—'}</div>)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card stack">
            <h2 style={{ margin: 0 }}>Token use</h2>
            {usage.size === 0 && renders.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>Nothing has run yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Phase</th><th>Model</th><th className="r">Tokens in</th><th className="r">Tokens out</th><th className="r">Calls</th><th className="r">Spent</th></tr></thead>
                  <tbody>
                    {['spec', 'architect', 'build', 'review'].filter((ph) => usage.has(ph)).map((ph) => {
                      const u = usage.get(ph)!;
                      return (
                        <tr key={ph}>
                          <td>{PHASE_NAME[ph]}</td><td>{modelLabel(u.model)}</td>
                          <td className="r num">{u.input ? k(u.input) : '—'}</td><td className="r num">{u.output ? k(u.output) : '—'}</td>
                          <td className="r num">{u.calls || '—'}</td><td className="r num">{fine(u.spent)}</td>
                        </tr>
                      );
                    })}
                    {renders.length > 0 && (
                      <tr>
                        <td>Renders</td><td>{renders.length} version{renders.length > 1 ? 's' : ''}</td>
                        <td className="r num">{k(renderTokens.input)}</td><td className="r num">{k(renderTokens.output)}</td>
                        <td className="r num">{renders.length}</td><td className="r num">{fine(renderTokens.cost)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
