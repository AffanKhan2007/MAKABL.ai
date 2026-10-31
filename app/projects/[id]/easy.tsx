import { plainLanguage, type Conflict } from '../../../src/estimator/conflicts.ts';
import type { CostPlan } from '../../../src/estimator/estimator.ts';
import { horizonMonths } from '../../../src/domain/types.ts';
import { PRESETS, type PresetId } from '../../../src/server/plan.ts';
import type { Project } from '../../../src/server/projects.ts';
import type { FeatureStatus } from '../../../src/server/verification.ts';
import { money } from '../../format.ts';
import { setModeAction } from '../../mode-actions.ts';
import { applyPresetAction } from './actions.ts';

// Easy mode's view of a project: what it costs to build, what it costs to run, three ways
// to build it, and the few things worth knowing, in everyday words. Pro mode shows the rest.

const STATUS_TEXT: Record<FeatureStatus, { text: string; tone: string }> = {
  'not started': { text: 'Not started', tone: '' },
  building: { text: 'Building', tone: 'warn' },
  verified: { text: 'Done and checked', tone: 'good' },
  failed: { text: 'Needs another try', tone: 'bad' },
  refused: { text: 'Could not be built', tone: 'bad' },
};

/** Build cost (model usage) and the monthly running cost of the paid path. */
function costs(plan: CostPlan) {
  const paid = plan.paths[1];
  const build = paid.lines.filter((l) => l.phase && l.range);
  const run = paid.lines.filter((l) => !l.phase && l.range);
  const months = horizonMonths[plan.horizon];
  const sum = (ls: typeof build, k: 'low' | 'expected' | 'high') => ls.reduce((t, l) => t + l.range![k], 0);
  return {
    build: { low: sum(build, 'low'), expected: sum(build, 'expected'), high: sum(build, 'high') },
    monthly: months > 0 ? Math.round(sum(run, 'expected') / months) : null,
  };
}

export function EasyOverview({ project, plan, presets, current, conflicts, features, canChange }: {
  project: Project;
  plan: CostPlan;
  presets: Record<PresetId, CostPlan>;
  current: PresetId | null;
  conflicts: Conflict[];
  features: Array<{ taskId: string; name: string; status: FeatureStatus }>;
  canChange: boolean;
}) {
  const c = costs(plan);
  const things = [...new Set(conflicts.map(plainLanguage).filter((t): t is string => !!t))].slice(0, 5);

  return (
    <>
      <section className="card stack">
        <h2 style={{ margin: 0 }}>What it will cost</h2>
        <div className="easy-costs">
          <div className="easy-cost">
            <div className="kpi-label">To build it</div>
            <div className="big">about {money(c.build.expected)}</div>
            <div className="muted small">Could be {money(c.build.low)} to {money(c.build.high)}. AI work varies, so we show a range.</div>
          </div>
          <div className="easy-cost">
            <div className="kpi-label">To keep it running</div>
            {c.monthly === null
              ? <div className="muted" style={{ marginTop: 8 }}>Not included: this plan covers building only.</div>
              : <>
                <div className="big">about {money(c.monthly)}<span className="muted small"> / month</span></div>
                <div className="muted small">Website hosting and the database, for about {project.spec.monthlyVisitors?.toLocaleString('en-US') ?? 'a few'} visitors a month.</div>
              </>}
          </div>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          You set a spending limit before anything starts. If building would go over it, MAKABL stops and asks you first.
        </p>
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>How should we build it?</h2>
        <form action={applyPresetAction.bind(null, project.id)} className="presets">
          {(Object.keys(PRESETS) as PresetId[]).map((id) => {
            const p = PRESETS[id];
            const cost = costs(presets[id]).build;
            return (
              <button key={id} type="submit" name="preset" value={id} className="preset"
                aria-pressed={current === id} disabled={!canChange || current === id}>
                <strong>{p.label}{current === id ? ' ✓' : ''}</strong>
                <div className="price">about {money(cost.expected)}</div>
                <span className="muted small">{p.blurb}</span>
              </button>
            );
          })}
        </form>
        {current === null && (
          <p className="muted small" style={{ margin: 0 }}>This project uses a custom setup from Pro mode. Pick one above to switch.</p>
        )}
      </section>

      {things.length > 0 && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Good to know</h2>
          <ul className="things">{things.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>
      )}

      <section className="card stack">
        <h2 style={{ margin: 0 }}>What we will build</h2>
        <ul className="project-list">
          {features.map((f) => (
            <li key={f.taskId} className="row spread" style={{ padding: '8px 0', borderBottom: '1px dashed var(--border)' }}>
              <span>{f.name}</span>
              <span className={`badge ${STATUS_TEXT[f.status].tone}`}>{STATUS_TEXT[f.status].text}</span>
            </li>
          ))}
        </ul>
        <form action={setModeAction} className="row small">
          <span className="muted">Want every model, number and setting?</span>
          <button type="submit" name="mode" value="pro" className="secondary small">Switch to Pro mode</button>
        </form>
      </section>
    </>
  );
}
