import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PgEventLog } from '../../../../src/db/pg-event-log.ts';
import { designTargets } from '../../../../src/relay/render.ts';
import { db } from '../../../../src/server/db.ts';
import { getProject } from '../../../../src/server/projects.ts';
import { userScope } from '../../../../src/server/session.ts';
import { addNoteAction, continueAction, setCheckpointAction } from './actions.ts';

export const dynamic = 'force-dynamic';

export default async function SteerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();
  const events = await new PgEventLog(db(), await userScope()).list(id);
  const v = `v${project.specVersion}`;
  const last = (t: string) => [...events].reverse().find((e) => e.type === t);
  const specBrief = [...events].reverse().find((e) => e.type === 'relay_handoff' && e.payload.from === 'spec');
  const archBrief = [...events].reverse().find((e) => e.type === 'relay_handoff' && e.payload.from === 'architect');
  const edit = [...events].reverse().find((e) => e.type === 'owner_brief_edit' && e.payload.v === v);
  const brief = String(edit?.payload.text ?? archBrief?.payload.brief ?? '');
  const level = String(last('owner_checkpoint')?.payload.level ?? 'none');
  const approved = new Set(events.filter((e) => e.type === 'owner_approved' && e.payload.v === v).map((e) => String(e.payload.stage)));
  const stop = last('relay_checkpoint');
  const waiting = project.state === 'paused' && stop && stop.payload.v === v && !approved.has(String(stop.payload.stage)) ? stop : null;
  const notes = events.filter((e) => e.type === 'owner_note');
  const designs = designTargets(events);
  const fids = events.filter((e) => e.type === 'relay_fidelity');
  const oversight = events.filter((e) => e.type === 'relay_review' && e.payload.overseer);

  return (
    <main className="renders-page stack">
      <p className="small" style={{ margin: 0 }}><Link href={`/projects/${id}`}>← {project.name}</Link></p>
      <span className="eyebrow">Plan and steer</span>
      <h1 style={{ margin: 0 }}>Steer the build</h1>
      <p className="sub">Read the plan the models wrote, change it, tell the builder what you want, and decide when the build stops for you. An overseer model checks every feature against your render and your notes.</p>

      {waiting && (
        <form action={continueAction.bind(null, id, String(waiting.payload.stage))} className="card stack">
          <h2 style={{ margin: 0 }}>Paused for you: {String(waiting.payload.label)}</h2>
          <label htmlFor="brief">Technical plan (edit it freely; the builder follows what you leave here)</label>
          <textarea id="brief" name="brief" rows={14} defaultValue={brief} />
          <input type="hidden" name="original" value={brief} />
          <button type="submit">Approve and continue the build</button>
          <span className="hint">Add instructions below first if you want them in this step.</span>
        </form>
      )}

      <section className="card stack">
        <h2 style={{ margin: 0 }}>When should the build stop for you?</h2>
        <form action={setCheckpointAction.bind(null, id)} className="row">
          <select name="level" defaultValue={level} aria-label="Stop points">
            <option value="none">Never, run to the end</option>
            <option value="brief">Once, after the plan is written</option>
            <option value="feature">After every feature</option>
          </select>
          <button type="submit" className="secondary">Save</button>
        </form>
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>Tell the builder something</h2>
        <form action={addNoteAction.bind(null, id)} className="stack">
          <select name="feature" aria-label="Applies to">
            <option value="">All features</option>
            {project.spec.features.map((f) => <option key={f.name}>{f.name}</option>)}
          </select>
          <textarea name="text" rows={3} maxLength={600} placeholder="For example: use my logo colours #1b4332 and #d8f3dc; keep the menu on the first screen; no sign-in." required />
          <button type="submit">Add instruction</button>
        </form>
        {notes.length > 0 && <ul className="small">{notes.map((n) => <li key={n.seq}><strong>{String(n.payload.feature ?? 'All')}:</strong> {String(n.payload.text)}</li>)}</ul>}
        <span className="hint">Instructions override the plan where they conflict and apply from the next feature built.</span>
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>What the build is held to</h2>
        {designs.length === 0
          ? <p className="muted small" style={{ margin: 0 }}>No render yet. <Link href={`/projects/${id}/renders`}>Draw one</Link> and the build will match it.</p>
          : <ul className="small">{designs.map((d) => <li key={d.page}>{d.page}: render v{d.n}</li>)}</ul>}
        {fids.map((e) => (
          <p key={e.seq} className="small" style={{ margin: 0 }}>
            {String(e.payload.feature)}: {Math.round(Number(e.payload.score) * 100)}% of the render's colours and wording found in the code
            {Number(e.payload.score) < 1 ? ` (missing ${[...(e.payload.missingColours as string[]), ...(e.payload.missingTexts as string[]).map((t) => `"${t}"`)].join(', ')})` : ''}
          </p>
        ))}
        {oversight.map((e) => <p key={e.seq} className="small" style={{ margin: 0 }}><strong>Overseer, {String(e.payload.feature)}:</strong> {String(e.payload.review).slice(0, 400)}</p>)}
      </section>

      {specBrief && (
        <details className="card"><summary>Spec brief</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{String(specBrief.payload.brief)}</pre></details>
      )}
    </main>
  );
}
