import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PgEventLog } from '../../../../src/db/pg-event-log.ts';
import { featurePoints, QUALITY_WEIGHTS } from '../../../../src/relay/quality.ts';
import { gate } from '../../../../src/server/builds.ts';
import { db } from '../../../../src/server/db.ts';
import { getProject } from '../../../../src/server/projects.ts';
import { userScope } from '../../../../src/server/session.ts';
import { taskIdFor } from '../../../../src/spec/acceptance.ts';
import { money } from '../../../format.ts';

export const dynamic = 'force-dynamic';

const W = 640, H = 320, L = 52, R = 20, T = 20, B = 44;

export default async function QualityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();
  const events = await new PgEventLog(db(), await userScope()).list(id);
  const costByTask = new Map<string, number>();
  for (const e of await (await gate()).ledgerFor(id)) costByTask.set(e.taskId, (costByTask.get(e.taskId) ?? 0) + e.amount);
  const pts = featurePoints(project.spec.features.map((f) => ({ name: f.name, taskId: taskIdFor(f) })), events, costByTask);

  const maxCost = Math.max(1, ...pts.map((p) => p.cumulative)) * 1.1;
  const x = (c: number) => L + (c / maxCost) * (W - L - R);
  const y = (s: number) => T + (1 - s / 100) * (H - T - B);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.cumulative).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');

  return (
    <main className="renders-page stack">
      <p className="small" style={{ margin: 0 }}><Link href={`/projects/${id}`}>← {project.name}</Link></p>
      <span className="eyebrow">Quality and cost</span>
      <h1 style={{ margin: 0 }}>What the money bought</h1>
      <p className="sub">Each point is a feature that was built: how much was spent in total by then, and how good the result measured. Cost is real money from the ledger, including the review, overseer and any repair pass.</p>

      {pts.length === 0 ? (
        <p className="card muted">No feature has been built yet. Build one and its point appears here.</p>
      ) : (
        <section className="card stack">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Quality score against cumulative cost for each built feature" style={{ width: '100%', height: 'auto' }}>
            {[0, 25, 50, 75, 100].map((s) => (
              <g key={s}>
                <line x1={L} x2={W - R} y1={y(s)} y2={y(s)} stroke="currentColor" opacity="0.12" />
                <text x={L - 8} y={y(s) + 4} textAnchor="end" fontSize="11" fill="currentColor" opacity="0.7">{s}</text>
              </g>
            ))}
            {[0, 0.5, 1].map((f) => (
              <text key={f} x={x(maxCost * f)} y={H - B + 18} textAnchor="middle" fontSize="11" fill="currentColor" opacity="0.7">{money(Math.round(maxCost * f))}</text>
            ))}
            <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" fontSize="12" fill="currentColor">Total spent so far</text>
            <text x={14} y={H / 2} fontSize="12" fill="currentColor" transform={`rotate(-90 14 ${H / 2})`} textAnchor="middle">Quality (0-100)</text>
            <path d={line} fill="none" stroke="var(--accent, #4f6bed)" strokeWidth="2" />
            {pts.map((p) => (
              <g key={p.feature}>
                <circle cx={x(p.cumulative)} cy={y(p.score)} r="6" fill="var(--accent, #4f6bed)"><title>{`${p.feature}: quality ${p.score}, ${money(p.cost)}`}</title></circle>
                <text x={x(p.cumulative)} y={y(p.score) - 11} textAnchor="middle" fontSize="11" fill="currentColor">{p.feature.slice(0, 18)}</text>
              </g>
            ))}
          </svg>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Feature</th><th>Cost</th><th>Quality</th><th>Quality per cent</th></tr></thead>
              <tbody>{pts.map((p) => (
                <tr key={p.feature}><td>{p.feature}</td><td className="num">{money(p.cost)}</td><td className="num">{p.score}</td>
                  <td className="num">{p.cost > 0 ? (p.score / (p.cost / 10_000)).toFixed(1) : '—'}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card stack">
        <h2 style={{ margin: 0 }}>How quality is scored</h2>
        <p className="small" style={{ margin: 0 }}>
          Checks passed {QUALITY_WEIGHTS.checks} points (fewer for each retry), match to the chosen render {QUALITY_WEIGHTS.fidelity} (its colours and wording found in the code), reviewer {QUALITY_WEIGHTS.review}. A part that was not measured, such as a feature with no render, is left out and the rest rescaled.
          It is a measure of what the system could check, not a judgement of taste, and a small project has too few points to show a trend.
        </p>
      </section>
    </main>
  );
}
