import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CostLine, PathPlan } from '../../../src/estimator/estimator.ts';
import { gate, isRunning } from '../../../src/server/builds.ts';
import { liveModeStatus } from '../../../src/server/live-mode.ts';
import { BUILD_MODELS, planFor } from '../../../src/server/plan.ts';
import { getProject } from '../../../src/server/projects.ts';
import { FEATURE_TYPES, money, range, STATE_LABEL } from '../../format.ts';
import { approvePlanAction, decideApprovalAction, setBuildModeAction, startBuildAction } from './actions.ts';
import { Feed } from './feed.tsx';

export const dynamic = 'force-dynamic';

const HORIZON_TEXT = {
  build_only: 'the build only',
  first_month: 'the build and the first month of hosting',
  first_12_months: 'the build and the first 12 months of hosting',
} as const;

function Lines({ lines }: { lines: CostLine[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Item</th><th className="r">Low – high</th><th className="r">Expected</th></tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.label}>
              <td>
                {l.label}
                <div className="muted small">
                  {l.lineClass} · {l.confidence} confidence{l.priceIsAssumption ? ' · price unverified' : ''}
                </div>
                {l.warnings.length > 0 && (
                  <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18, color: 'var(--warn)' }}>
                    {l.warnings.map((w) => <li key={w}>{w}</li>)}
                  </ul>
                )}
              </td>
              <td className="r num">{l.range ? range(l.range) : '—'}</td>
              <td className="r num">{l.range ? money(l.range.expected) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PathCard({ p }: { p: PathPlan }) {
  return (
    <section className="card stack">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>{p.path === 'free' ? 'Free path' : 'Paid path'}</h2>
        <span className={`badge ${p.eligible ? 'good' : 'bad'}`}>{p.eligible ? 'Eligible' : 'Not eligible'}</span>
      </div>
      <div>
        <div className="total num">{money(p.totals.expected)}</div>
        <div className="muted small num">expected · range {range(p.totals)}</div>
      </div>
      {p.ineligibleReasons.map((r) => <p key={r} className="notice bad" style={{ margin: 0 }}>{r}</p>)}
      <Lines lines={p.lines} />
      {p.unpriced.length > 0 && (
        <div>
          <h3>Not included in the total</h3>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {p.unpriced.map((u) => <li key={u.label}>{u.label}</li>)}
          </ul>
        </div>
      )}
      {p.upgradeCliffs.length > 0 && (
        <div>
          <h3>Where this path gets more expensive</h3>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {p.upgradeCliffs.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}

export default async function ProjectPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const project = await getProject(id);
  if (!project) notFound();

  const g = await gate();
  const plan = await planFor(project.spec);
  const budget = await g.getBudget(id).catch(() => null);
  const [spent, ledger, approvals] = budget
    ? await Promise.all([g.spent(id), g.ledgerFor(id), g.pendingApprovals(id)])
    : [0, [], []];
  const running = isRunning(id);
  // "building" with nothing running means the server restarted mid-build.
  const interrupted = project.state === 'building' && !running;
  const live = liveModeStatus();
  const s = interrupted
    ? { text: 'Interrupted', tone: 'bad' as const }
    : STATE_LABEL[project.state] ?? { text: project.state, tone: '' as const };
  const paid = plan.paths.find((p) => p.path === 'paid')!;
  const buildExpected = paid.lines.filter((l) => l.unit === 'tokens').reduce((a, l) => a + (l.range?.expected ?? 0), 0);
  const buildHigh = paid.lines.filter((l) => l.unit === 'tokens').reduce((a, l) => a + (l.range?.high ?? 0), 0);
  const suggestedCap = Math.max(1, Math.ceil(buildExpected / 1_000_000) * 2);
  const modelLabel = BUILD_MODELS.find((m) => m.id === project.spec.buildModel)?.label ?? project.spec.buildModel;
  const cov = plan.calibration.coverage;
  const canBuild = (project.state === 'approved' || project.state === 'paused' || interrupted)
    && approvals.length === 0 && !running && (project.buildMode === 'simulated' || live.available);
  const canChangeMode = !running && ledger.length === 0;

  return (
    <main>
      <p className="small" style={{ margin: '0 0 8px' }}><Link href="/">← Projects</Link></p>
      <div className="row spread" style={{ marginBottom: 4 }}>
        <h1>{project.name}</h1>
        <div className="row">
          {project.buildMode === 'simulated'
            ? <span className="badge">Simulated build</span>
            : <span className="badge warn">Live build</span>}
          <span className={`badge ${s.tone}`}>{running ? 'Building…' : s.text}</span>
        </div>
      </div>
      <p className="sub">{project.spec.idea}</p>

      {error && <p className="notice bad" role="alert">{error}</p>}
      {project.buildMode === 'simulated' ? (
        <p className="notice warn">
          Simulated build: a scripted stand-in plays the model. No API calls are made, no real money is spent,
          and these runs never feed the cost estimates. The costs shown are what the same calls would cost.
        </p>
      ) : (
        <p className="notice bad">
          Live build: calls the Claude API on your key and spends real money, within the caps below. Generated code
          is installed, tested and built on this computer without a sandbox.
        </p>
      )}

      <section className="card">
        <h2>Features</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Feature</th><th>Type</th></tr></thead>
            <tbody>
              {project.spec.features.map((f) => (
                <tr key={f.name}>
                  <td>{f.name}</td>
                  <td className="muted">{FEATURE_TYPES.find((t) => t.value === f.type)?.label ?? f.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <h2 style={{ marginTop: 24 }}>Cost plan</h2>
      <p className="muted small" style={{ marginTop: -6 }}>
        Covers {HORIZON_TEXT[project.spec.horizon]}, built with {modelLabel}.{' '}
        {plan.calibration.calibrated
          ? `Build lines use ${plan.calibration.runs} logged runs.`
          : `Build lines are estimates from a model of the build, not yet from real runs (${plan.calibration.runs} logged).`}{' '}
        Track record:{' '}
        {cov.share === null
          ? `not enough data yet (${cov.quotedRuns} quoted builds; 10 needed).`
          : `${Math.round(cov.share * 100)}% of ${cov.quotedRuns} builds landed inside their quoted range.`}
      </p>
      <div className="grid2">
        {plan.paths.map((p) => <PathCard key={p.path} p={p} />)}
      </div>
      <section className="card small muted">
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {plan.assumptions.map((a) => <li key={a}>{a}</li>)}
          {plan.disclosures.map((d) => <li key={d}>{d}</li>)}
        </ul>
      </section>

      <div className="grid2" style={{ marginTop: 24 }}>
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Budget</h2>
          {budget ? (
            <>
              <div className="row spread"><span className="muted">Project cap</span><span className="num">{money(budget.projectCap)}</span></div>
              <div className="row spread"><span className="muted">Monthly cap</span><span className="num">{money(budget.monthlyCap)}</span></div>
              <div className="row spread"><span className="muted">Spent on the build</span><span className="num">{money(spent)}</span></div>
              <div className="row spread"><span className="muted">Plan expected the build at</span><span className="num">{money(buildExpected)} (up to {money(buildHigh)})</span></div>
              <p className="muted small" style={{ margin: 0 }}>
                Each model call reserves its worst case before it runs, so the build pauses for approval
                before a cap could be crossed.
              </p>
            </>
          ) : (
            <form action={approvePlanAction.bind(null, id)} className="stack">
              <p className="muted small" style={{ margin: 0 }}>
                Approving starts nothing. It sets the caps the build must stay under; it pauses and asks
                before going over.
              </p>
              <div>
                <label htmlFor="projectCap">Project cap (USD) <span className="hint">build spend in total</span></label>
                <input id="projectCap" name="projectCap" type="number" min="0.01" max="10000" step="0.01" defaultValue={suggestedCap} required />
              </div>
              <div>
                <label htmlFor="monthlyCap">Monthly cap (USD)</label>
                <input id="monthlyCap" name="monthlyCap" type="number" min="0.01" max="10000" step="0.01" defaultValue={suggestedCap} required />
              </div>
              <button type="submit">Approve plan and set caps</button>
            </form>
          )}
        </section>

        <section className="card stack">
          <h2 style={{ margin: 0 }}>Build</h2>
          {!budget && <p className="muted" style={{ margin: 0 }}>Approve the plan first.</p>}
          {running && <p className="notice warn" style={{ margin: 0 }}>Building now. Follow it in the live feed.</p>}
          {interrupted && (
            <p className="notice bad" style={{ margin: 0 }}>
              The build stopped when the server restarted. Resuming replays finished steps at no cost.
            </p>
          )}
          {project.buildMode === 'live' && !live.available && (
            <p className="notice bad" style={{ margin: 0 }}>Live builds are not enabled on this server. {live.missing.join('. ')}.</p>
          )}
          {project.state === 'verifying' && !running && (
            <p className="notice good" style={{ margin: 0 }}>
              Every feature passed its checks. Integration checks and the preview deploy are not built yet.
            </p>
          )}
          {approvals.length > 0 && <p className="notice bad" style={{ margin: 0 }}>Paused: decide the approval below to continue.</p>}
          {budget && project.state !== 'verifying' && (
            <form action={startBuildAction.bind(null, id)}>
              <button type="submit" disabled={!canBuild}>
                {project.state === 'paused' || interrupted ? 'Resume build' : 'Start build'}
              </button>
            </form>
          )}
        </section>
      </div>

      {canChangeMode && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Build mode</h2>
          {project.buildMode === 'live' ? (
            <form action={setBuildModeAction.bind(null, id)} className="row">
              <span>This project will call the Claude API.</span>
              <button type="submit" name="mode" value="simulated" className="secondary">Switch back to simulated</button>
            </form>
          ) : live.available ? (
            <form action={setBuildModeAction.bind(null, id)} className="stack">
              <p style={{ margin: 0 }}>
                A live build has Claude write the app for real on the Next.js starter project, spending money on your
                API key within the caps, and logs each feature's real cost so future estimates improve.
              </p>
              <label className="check">
                <input type="checkbox" name="confirm" value="yes" required />
                I understand this spends real money and runs generated code on this computer without a sandbox.
              </label>
              <div><button type="submit" name="mode" value="live">Switch to live build</button></div>
            </form>
          ) : (
            <div className="muted small">
              <p style={{ margin: '0 0 6px' }}>Live builds are off on this server. To turn them on:</p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>{live.missing.map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      {approvals.map((a) => (
        <section key={a.id} className="card stack" style={{ borderColor: 'var(--bad)' }}>
          <h2 style={{ margin: 0 }}>Approval needed</h2>
          <p style={{ margin: 0 }}>{a.reason}</p>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr><th>Blocked task</th><td>{a.blockedTaskId ?? '—'}</td></tr>
                <tr><th>Next call could cost</th><td className="num">{money(a.costRange.low)} – {money(a.costRange.high)}</td></tr>
                <tr><th>Who bills</th><td>{a.whoBills}</td></tr>
                <tr><th>Cancellable</th><td>{a.cancellable}</td></tr>
                <tr><th>If you decline</th><td>{a.consequenceOfDeclining}</td></tr>
                <tr><th>Options</th><td><ul style={{ margin: 0, paddingLeft: 18 }}>{a.alternatives.map((x) => <li key={x}>{x}</li>)}</ul></td></tr>
              </tbody>
            </table>
          </div>
          <form action={decideApprovalAction.bind(null, id, a.id)} className="row">
            <div style={{ minWidth: 180 }}>
              <label htmlFor={`raise-${a.id}`}>Raise both caps by (USD)</label>
              <input id={`raise-${a.id}`} name="raiseBy" type="number" min="0.01" max="10000" step="0.01"
                defaultValue={Math.max(1, Math.ceil(a.costRange.high / 1_000_000))} />
            </div>
            <button type="submit" name="decision" value="approved">Approve and resume</button>
            <button type="submit" name="decision" value="declined" className="danger" formNoValidate>Decline</button>
          </form>
        </section>
      ))}

      <Feed projectId={id} />

      {ledger.length > 0 && (
        <section className="card">
          <h2>Ledger</h2>
          <p className="muted small" style={{ marginTop: -6 }}>Every charge the Budget Gate booked, from system records.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Call</th><th>Basis</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {ledger.map((e) => (
                  <tr key={e.reservationId}>
                    <td>{e.description}</td>
                    <td className="muted">{e.basis.replace('_', ' ')}</td>
                    <td className="r num">{money(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
