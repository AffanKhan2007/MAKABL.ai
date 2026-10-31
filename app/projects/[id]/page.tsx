import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';
import { PRIOR_RETRY_RATE, type CostLine, type PathPlan } from '../../../src/estimator/estimator.ts';
import { gate, isRunning } from '../../../src/server/builds.ts';
import { liveModeStatus } from '../../../src/server/live-mode.ts';
import {
  DEFAULT_RELAY, MODELS, modelLabel as labelOf, planFor, presetOf, presetPlans, registry, today,
} from '../../../src/server/plan.ts';
import { RETRY_CHOICES, whatIf } from '../../../src/server/what-if.ts';
import { WhatIf } from './what-if.tsx';
import { EasyOverview } from './easy.tsx';
import { RelayTimeline } from './relay-timeline.tsx';
import { rendersOf } from '../../../src/server/design.ts';
import { LiveView } from './live-view.tsx';
import { PgEventLog } from '../../../src/db/pg-event-log.ts';
import { db } from '../../../src/server/db.ts';
import { getMode } from '../../../src/server/mode.ts';
import { getProject } from '../../../src/server/projects.ts';
import { FEATURE_TYPES, money, range, STATE_LABEL } from '../../format.ts';
import { diffSpecs } from '../../../src/spec/diff.ts';
import { getSpecVersion } from '../../../src/server/projects.ts';
import { userScope } from '../../../src/server/session.ts';
import { loadReport, type FeatureStatus } from '../../../src/server/verification.ts';
import { previewOf } from '../../../src/build/preview.ts';
import {
  approvePlanAction, decideApprovalAction, deleteProjectAction, setBuildModeAction, startBuildAction,
  startPreviewAction, stopPreviewAction,
} from './actions.ts';

const STEPS = ['Plan', 'Approve', 'Build', 'Verified'] as const;

/** Which step the project is on; past the last index means every step is done. */
function stepIndex(state: string): number {
  if (state === 'draft' || state === 'scoped' || state === 'planned') return 0;
  if (state === 'costed') return 1;
  if (state === 'approved' || state === 'building' || state === 'paused') return 2;
  return STEPS.length;
}

const FEATURE_TONE: Record<FeatureStatus, '' | 'good' | 'warn' | 'bad'> = {
  'not started': '', building: 'warn', verified: 'good', failed: 'bad', refused: 'bad',
};
import { Feed } from './feed.tsx';
import { applyWhatIfAction, whatIfAction } from './actions.ts';

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
  const provider = registry.get(project.spec.buildModel).provider;
  const live = liveModeStatus(process.env, provider);
  const s = interrupted
    ? { text: 'Interrupted', tone: 'bad' as const }
    : STATE_LABEL[project.state] ?? { text: project.state, tone: '' as const };
  const paid = plan.paths.find((p) => p.path === 'paid')!;
  const buildExpected = paid.lines.filter((l) => l.unit === 'tokens').reduce((a, l) => a + (l.range?.expected ?? 0), 0);
  const buildHigh = paid.lines.filter((l) => l.unit === 'tokens').reduce((a, l) => a + (l.range?.high ?? 0), 0);
  const suggestedCap = Math.max(1, Math.ceil(buildExpected / 1_000_000) * 2);
  const modelLabel = labelOf(project.spec.buildModel);
  const explore = await whatIf(project.spec, paid.totals.expected, {
    ...(budget ? { capMicros: budget.projectCap } : {}),
    live: project.buildMode === 'live',
  });
  const easy = (await getMode()) === 'easy';
  const presets = easy ? await presetPlans(project.spec) : null;
  const cov = plan.calibration.coverage;
  const canBuild = (project.state === 'approved' || project.state === 'paused' || interrupted)
    && approvals.length === 0 && !running && project.buildMode === 'live' && live.available;
  const canChangeMode = !running && ledger.length === 0;
  const scope = await userScope();
  const report = await loadReport(project, scope);
  const projectEvents = await new PgEventLog(db(), scope).list(id);
  const relay = project.spec.relay;
  const mockups = rendersOf(projectEvents);
  const mockupCost = mockups.reduce((t, r) => t + r.cost, 0);
  const mockupTokens = mockups.reduce((t, r) => t + r.tokens.input + r.tokens.output, 0);
  const showRelay = !!relay || projectEvents.some((e) => e.type === 'relay_phase_started');
  const plannedModels = {
    spec: relay?.spec ?? project.spec.buildModel,
    architect: relay?.architect ?? project.spec.buildModel,
    build: project.spec.buildModel,
    review: relay?.review ?? project.spec.buildModel,
  };
  const phaseEstimate = Object.fromEntries((plan.relay?.phases ?? []).map((ph) => [ph.phase, ph.range.expected]));
  const preview = previewOf(id);
  const appBuilt = project.buildMode === 'live' && report.features.length > 0
    && report.features.every((f) => f.status === 'verified');

  // FR-15: estimate vs actual per feature, from the ledger (system records only).
  const spentByTask = new Map<string, number>();
  for (const e of ledger) spentByTask.set(e.taskId, (spentByTask.get(e.taskId) ?? 0) + e.amount);
  const quotedFor = (name: string) => paid.lines.find((l) => l.label === `Build: ${name}`)?.range ?? null;
  const remaining = report.features.filter((f) => f.status !== 'verified')
    .reduce((a, f) => a + (quotedFor(f.name)?.expected ?? 0), 0);

  // FR-29: after a change request, what changed and what it does to the cost.
  const previousSpec = project.specVersion > 1 && project.state === 'costed'
    ? await getSpecVersion(id, project.specVersion - 1) : null;
  const change = previousSpec ? diffSpecs(previousSpec, project.spec) : null;
  const previousPlan = previousSpec ? await planFor(previousSpec) : null;
  const previousPaid = previousPlan?.paths.find((p) => p.path === 'paid');
  const built = new Set(report.features.filter((f) => f.status === 'verified').map((f) => f.name));
  const anyBuilt = report.features.some((f) => f.status !== 'not started');

  return (
    <main>
      <p className="small" style={{ margin: '0 0 10px' }}><Link href="/projects">← Projects</Link></p>
      <div className="row spread" style={{ marginBottom: 6, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1>{project.name}</h1>
          <p className="sub" style={{ marginBottom: 0 }}>{project.spec.idea}</p>
        </div>
        <div className="row">
          {project.buildMode === 'simulated'
            ? <span className="badge">Simulated</span>
            : <span className="badge warn">Live</span>}
          <span className={`badge ${s.tone}`}>{running ? 'Building…' : s.text}</span>
        </div>
      </div>
      <div className="row small" style={{ margin: '10px 0 18px' }}>
        <span className="muted num">spec v{project.specVersion}</span>
        {!running && <Link href={`/projects/${id}/edit`}>Change the spec</Link>}
        <a href={`/api/projects/${id}/export`}>Export (zip)</a>
      </div>

      <ol className="stepper" aria-label="Progress">
        {STEPS.map((label, i) => {
          const at = stepIndex(project.state);
          return <li key={label} className={i < at ? 'done' : i === at ? 'current' : ''}>{label}</li>;
        })}
      </ol>

      {!easy && <div className="kpis">
        <div className="kpi">
          <div className="kpi-label">Paid path</div>
          <div className="kpi-value">{money(paid.totals.expected)}</div>
          <div className="kpi-note num">{range(paid.totals)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Build estimate</div>
          <div className="kpi-value">{money(buildExpected)}</div>
          <div className="kpi-note num">up to {money(buildHigh)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Budget cap</div>
          <div className="kpi-value">{budget ? money(budget.projectCap) : '—'}</div>
          <div className="kpi-note">{budget ? 'enforced before every call' : 'not set yet'}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Spent</div>
          <div className="kpi-value">{money(spent)}</div>
          {budget
            ? <div className="bar meter" aria-label={`${Math.round((spent / budget.projectCap) * 100)}% of cap`}><span style={{ '--fill': Math.min(1, spent / budget.projectCap) } as CSSProperties} /></div>
            : <div className="kpi-note">nothing yet</div>}
        </div>
      </div>}

      {error && <p className="notice bad" role="alert">{error}</p>}
      {project.buildMode === 'simulated' ? (
        easy ? (
          <p className="notice info small">
            <strong>Practice run.</strong> Nothing is charged. Prices show what a real build would cost.
          </p>
        ) : <p className="notice info small">
          <strong>Simulated build.</strong> A scripted stand-in plays the model: no API calls, no real money, and
          these runs never feed the estimates. Costs shown are what the same calls would cost.
        </p>
      ) : (
        <p className="notice bad">
          {easy
            ? 'Real build: AI services are paid per use on your keys, never past your limit. The app it writes is installed and tested on this computer.'
            : 'Live build: calls each phase’s model API on your keys (real money unless on a free tier), within the caps below. Generated code is installed, tested and built on this computer without a sandbox.'}
        </p>
      )}

      {easy && presets ? (
        <EasyOverview project={project} plan={plan} presets={presets} current={presetOf(project.spec)}
          conflicts={explore.conflicts} features={report.features} canChange={!running} />
      ) : <section className="card">
        <h2>Features</h2>
        <p className="muted small" style={{ marginTop: -6 }}>Quoted from the paid path; actual from the ledger.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Feature</th><th>Status</th><th className="r">Quoted</th><th className="r">Actual</th></tr></thead>
            <tbody>
              {report.features.map((f) => {
                const q = quotedFor(f.name);
                const actual = spentByTask.get(f.taskId) ?? 0;
                const outside = q && actual > 0 && (actual < q.low || actual > q.high);
                return (
                  <tr key={f.taskId}>
                    <td>
                      {f.name}{' '}
                      <span className="muted small">
                        {FEATURE_TYPES.find((t) => t.value === project.spec.features.find((x) => x.name === f.name)?.type)?.label}
                      </span>
                      <details>
                        <summary className="small muted">Acceptance criteria ({f.acceptance.length})</summary>
                        <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                          {f.acceptance.map((a) => <li key={a}>{a}</li>)}
                        </ul>
                      </details>
                    </td>
                    <td><span className={`badge ${FEATURE_TONE[f.status]}`}>{f.status}</span></td>
                    <td className="r num">{q ? range(q) : '—'}</td>
                    <td className="r num">
                      {actual ? money(actual) : '—'}
                      {outside && <div className="small" style={{ color: 'var(--warn)' }}>outside range</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {anyBuilt && remaining > 0 && (
          <p className="muted small" style={{ margin: '8px 0 0' }}>
            Features not yet verified are expected to cost {money(remaining)} more to build.
          </p>
        )}
      </section>}

      {change && previousPaid && (
        <section className="card stack" style={{ borderColor: 'var(--accent)' }}>
          <h2 style={{ margin: 0 }}>Changes since spec v{project.specVersion - 1}</h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {change.added.map((f) => <li key={`a-${f.name}`}>Added <strong>{f.name}</strong></li>)}
            {change.removed.map((f) => <li key={`r-${f.name}`}>Removed <strong>{f.name}</strong> (its files stay in the project)</li>)}
            {change.changed.map((c) => <li key={`c-${c.after.name}`}>Changed <strong>{c.after.name}</strong>: {c.what.join(' and ')}; it will be rebuilt</li>)}
            {change.settings.length > 0 && <li>Also changed: {change.settings.join(', ')}</li>}
            {change.unchanged.filter((f) => built.has(f.name)).length > 0 && (
              <li className="muted">
                Already built and unchanged, so not rebuilt: {change.unchanged.filter((f) => built.has(f.name)).map((f) => f.name).join(', ')}
              </li>
            )}
          </ul>
          <div className="row spread">
            <span className="muted">Paid path, expected</span>
            <span className="num">
              {money(previousPaid.totals.expected)} → {money(paid.totals.expected)}{' '}
              <strong>({paid.totals.expected >= previousPaid.totals.expected ? '+' : '−'}{money(Math.abs(paid.totals.expected - previousPaid.totals.expected))})</strong>
            </span>
          </div>
          <p className="muted small" style={{ margin: 0 }}>Approve the updated plan below to build the changes.</p>
        </section>
      )}

      <section className="card row spread design-link">
        <div>
          <span className="eyebrow">{easy ? 'Before we build' : 'Design mockup'}</span>
          <h2 style={{ margin: '4px 0 2px' }}>{easy ? 'See what it will look like' : 'Wireframe'}</h2>
          <p className="muted small" style={{ margin: 0 }}>
            {mockups.length
              ? `${mockups.length} version${mockups.length === 1 ? '' : 's'} so far · ${mockupTokens.toLocaleString('en-US')} tokens · ${mockupCost > 0 && mockupCost < 10_000 ? `$${(mockupCost / 1_000_000).toFixed(4)}` : money(mockupCost)}`
              : budget ? (easy ? 'A quick sketch of the main screens, for a fraction of a cent.' : 'Low-fidelity mockup of the main screens; one cheap call per version, on the cap.')
                : (easy ? 'Available once your limit is set.' : 'Available once the plan is approved.')}
          </p>
        </div>
        <Link className={`button${mockups.length ? ' secondary' : ''}`} href={`/projects/${id}/design`}>
          {mockups.length ? (easy ? 'See the sketches' : 'Open mockups') : (easy ? 'Show me' : 'Draw a mockup')}
        </Link>
      </section>
      <LiveView projectId={id} building={running} easy={easy} />

      {showRelay && (
        <RelayTimeline events={projectEvents} ledger={ledger} planned={plannedModels} estimate={phaseEstimate}
          label={labelOf} easy={easy} running={running} />
      )}

      {!easy && <>
      <h2 style={{ marginTop: 24 }}>Cost plan</h2>
      <p className="muted small" style={{ marginTop: -6 }}>
        Covers {HORIZON_TEXT[project.spec.horizon]}, {project.spec.relay
          ? <>run as a relay: {labelOf(project.spec.relay.spec)} → {labelOf(project.spec.relay.architect)} → {modelLabel} → {labelOf(project.spec.relay.review)}.</>
          : <>built with {modelLabel}.</>}{' '}
        {plan.calibration.calibrated
          ? `Build lines use ${plan.calibration.runs} logged runs.`
          : `Build lines are estimates from a model of the build, not yet from real runs (${plan.calibration.runs} logged).`}{' '}
        Track record:{' '}
        {cov.share === null
          ? `not enough data yet (${cov.quotedRuns} quoted builds; 10 needed).`
          : `${Math.round(cov.share * 100)}% of ${cov.quotedRuns} builds landed inside their quoted range.`}
      </p>
      <WhatIf
        action={whatIfAction.bind(null, id)}
        apply={applyWhatIfAction.bind(null, id)}
        initial={{ result: explore, error: null }}
        models={MODELS}
        defaults={{
          relay: project.spec.relay ?? DEFAULT_RELAY,
          relayOn: !!project.spec.relay,
          buildModel: project.spec.buildModel,
          retryRate: project.spec.retryRate ?? PRIOR_RETRY_RATE,
          caching: project.spec.caching ?? true,
          commercialUse: project.spec.commercialUse,
          horizon: project.spec.horizon,
          monthlyVisitors: project.spec.monthlyVisitors,
        }}
        retryChoices={RETRY_CHOICES}
        today={today()}
        canApply={!running}
        nextVersion={project.specVersion + 1}
      />
      <div className="grid2">
        {plan.paths.map((p) => <PathCard key={p.path} p={p} />)}
      </div>
      <section className="card small muted">
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {plan.assumptions.map((a) => <li key={a}>{a}</li>)}
          {plan.disclosures.map((d) => <li key={d}>{d}</li>)}
        </ul>
      </section>
      </>}

      <div className="grid2" style={{ marginTop: 24 }}>
        <section className="card stack">
          <h2 style={{ margin: 0 }}>{easy ? 'Spending limit' : 'Budget'}</h2>
          {project.state !== 'costed' && budget ? (
            <>
              <div className="row spread"><span className="muted">{easy ? 'Your limit' : 'Project cap'}</span><span className="num">{money(budget.projectCap)}</span></div>
              {!easy && <div className="row spread"><span className="muted">Monthly cap</span><span className="num">{money(budget.monthlyCap)}</span></div>}
              <div className="row spread"><span className="muted">{easy ? 'Spent so far' : 'Spent on the build'}</span><span className="num">{money(spent)}</span></div>
              <div className="row spread"><span className="muted">{easy ? 'We expected about' : 'Plan expected the build at'}</span><span className="num">{money(buildExpected)} (up to {money(buildHigh)})</span></div>
              <p className="muted small" style={{ margin: 0 }}>
                {easy
                  ? 'Before every step MAKABL sets aside the most it could cost, so it stops and asks before going over your limit.'
                  : 'Each model call reserves its worst case before it runs, so the build pauses for approval before a cap could be crossed.'}
              </p>
            </>
          ) : (
            <form action={approvePlanAction.bind(null, id)} className="stack">
              <p className="muted small" style={{ margin: 0 }}>
                {easy
                  ? 'This does not start anything. It sets the most the build may spend; it stops and asks before going over.'
                  : 'Approving starts nothing. It sets the caps the build must stay under; it pauses and asks before going over.'}
              </p>
              <div>
                <label htmlFor="projectCap">{easy ? 'The most you want to spend on building (USD)' : <>Project cap (USD) <span className="hint">build spend in total</span></>}</label>
                <input id="projectCap" name="projectCap" type="number" min="0.01" max="10000" step="0.01"
                  defaultValue={budget ? budget.projectCap / 1_000_000 : suggestedCap} required />
              </div>
              {easy
                ? <input type="hidden" name="monthlyCap" value={budget ? budget.monthlyCap / 1_000_000 : suggestedCap} />
                : <div>
                  <label htmlFor="monthlyCap">Monthly cap (USD)</label>
                  <input id="monthlyCap" name="monthlyCap" type="number" min="0.01" max="10000" step="0.01"
                    defaultValue={budget ? budget.monthlyCap / 1_000_000 : suggestedCap} required />
                </div>}
              {budget && <p className="muted small" style={{ margin: 0 }}>Spent so far: {money(spent)}. The caps include what is already spent.</p>}
              <button type="submit">{budget ? 'Approve updated plan' : easy ? 'Looks good, set my limit' : 'Approve plan and set caps'}</button>
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
              Every feature and the whole-project checks passed; see the verification report. Deploying is not built yet.
            </p>
          )}
          {approvals.length > 0 && <p className="notice bad" style={{ margin: 0 }}>Paused: decide the approval below to continue.</p>}
          {budget && project.state !== 'verifying' && (
            <form action={startBuildAction.bind(null, id)}>
              {provider === 'google' && (
                <p className="muted small" style={{ margin: '0 0 10px' }}>
                  Google may use prompts sent on its free API tier to improve its products. Use a paid-tier key for prompts excluded from product improvement.
                </p>
              )}
              <label className="check" style={{ marginBottom: 10 }}>
                <input type="checkbox" name="confirm" value="yes" required />
                I approve real calls to {provider === 'google' ? 'Google Gemini' : provider === 'openai' ? 'OpenAI' : provider === 'qwen' ? 'Qwen Cloud' : 'Anthropic Claude'} (and any other vendor the relay uses) within my caps, and generated code running on this computer without a sandbox.
              </label>
              <button type="submit" disabled={!canBuild}>
                {project.state === 'paused' || interrupted ? 'Resume build' : 'Start build'}
              </button>
            </form>
          )}
        </section>
      </div>

      {anyBuilt && (
        <section className="card stack">
          <div className="row spread">
            <h2 style={{ margin: 0 }}>Your app</h2>
            {preview && <span className={`badge ${preview.status === 'running' ? 'good' : preview.status === 'failed' ? 'bad' : ''}`}>{preview.status}</span>}
          </div>
          {project.buildMode === 'simulated' ? (
            <p className="muted small" style={{ margin: 0 }}>
              Simulated builds write placeholder files, so there is no app to run. A live build makes a real Next.js app
              you can open from here.
            </p>
          ) : !appBuilt ? (
            <p className="muted small" style={{ margin: 0 }}>The app can be opened once every feature has passed its checks.</p>
          ) : preview?.status === 'running' && preview.url ? (
            <div className="row">
              <a href={preview.url} target="_blank" rel="noreferrer" className="button">Open the app ↗</a>
              <span className="num muted small">{preview.url}</span>
              <form action={stopPreviewAction.bind(null, id)}><button type="submit" className="secondary small">Stop</button></form>
            </div>
          ) : (
            <form action={startPreviewAction.bind(null, id)} className="stack">
              <p className="muted small" style={{ margin: 0 }}>
                Runs the generated app on this computer so you can click through it. It gets no API keys.
              </p>
              <div><button type="submit">Run the app</button></div>
            </form>
          )}
          {preview?.status === 'failed' && preview.log && (
            <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 200, overflow: 'auto' }}>{preview.log.slice(-1500)}</pre>
          )}
        </section>
      )}

      {canChangeMode && !easy && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Build mode</h2>
          {project.buildMode === 'live' ? (
            <p style={{ margin: 0 }}>This project makes real {provider === 'google' ? 'Gemini' : provider === 'openai' ? 'OpenAI' : provider === 'qwen' ? 'Qwen' : 'Claude'} API calls using {modelLabel}. Usage is checked against your approved budget before each call.</p>
          ) : live.available ? (
            <form action={setBuildModeAction.bind(null, id)} className="stack">
              <p style={{ margin: 0 }}>
                Simulated builds are retired. Switching this existing project to live lets {modelLabel} build a real Next.js app through the budget gate.
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
          <p style={{ margin: 0 }}>{easy
            ? `The next step could cost up to ${money(a.costRange.high)}, more than your spending limit allows. Nothing was spent on it. Raise the limit to carry on, or stop here.`
            : a.reason}</p>
          {!easy && <div className="table-wrap">
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
          </div>}
          <form action={decideApprovalAction.bind(null, id, a.id)} className="row">
            <div style={{ minWidth: 180 }}>
              <label htmlFor={`raise-${a.id}`}>{easy ? 'Raise my limit by (USD)' : 'Raise both caps by (USD)'}</label>
              <input id={`raise-${a.id}`} name="raiseBy" type="number" min="0.01" max="10000" step="0.01"
                defaultValue={Math.max(1, Math.ceil(a.costRange.high / 1_000_000))} />
            </div>
            <button type="submit" name="decision" value="approved">Approve and resume</button>
            <button type="submit" name="decision" value="declined" className="danger" formNoValidate>Decline</button>
          </form>
        </section>
      ))}

      {anyBuilt && !easy && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Verification report</h2>
          <p className="muted small" style={{ margin: 0 }}>
            &ldquo;Verified&rdquo; means the checks below passed, nothing more. Who wrote each check&rsquo;s tests is shown.
          </p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Feature</th><th>Check</th><th>Tests by</th><th className="r">Result</th></tr></thead>
              <tbody>
                {report.features.flatMap((f) => f.checks.length === 0
                  ? [<tr key={f.taskId}><td>{f.name}</td><td className="muted" colSpan={3}>Not checked yet</td></tr>]
                  : f.checks.map((c, i) => (
                    <tr key={`${f.taskId}-${c.name}`}>
                      <td>{i === 0 ? f.name : ''}</td>
                      <td>{c.name} <span className="muted small">{c.gate}</span></td>
                      <td className="muted">{c.testsAuthoredBy === 'none' ? '—' : c.testsAuthoredBy}</td>
                      <td className="r"><span className={`badge ${c.passed ? 'good' : 'bad'}`}>{c.passed ? 'pass' : 'fail'}</span></td>
                    </tr>
                  )))}
                {report.projectChecks.map((c) => (
                  <tr key={c.name}>
                    <td>Whole project</td>
                    <td>
                      {c.name} <span className="muted small">{c.gate}</span>
                      {!c.passed && <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>{c.summary}</pre>}
                    </td>
                    <td className="muted">platform</td>
                    <td className="r"><span className={`badge ${c.passed ? 'good' : 'bad'}`}>{c.passed ? 'pass' : 'fail'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3>Not checked</h3>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {report.notChecked.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </div>
        </section>
      )}

      {easy
        ? <details className="card"><summary className="muted small">Show the live activity log</summary><Feed projectId={id} /></details>
        : <Feed projectId={id} />}

      {ledger.length > 0 && !easy && (
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

      {!running && (
        <section className="card stack" style={{ borderColor: 'var(--bad)' }}>
          <h2 style={{ margin: 0 }}>Delete project</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Permanently deletes the spec, plan, approvals, event log, ledger and code. Export first if you want a copy.
            Anonymous build costs (token counts and amounts, with no project details) are kept to improve estimates.
          </p>
          <form action={deleteProjectAction.bind(null, id)} className="row">
            <div style={{ minWidth: 220, flex: 1 }}>
              <label htmlFor="confirm-delete">Type <strong>{project.name}</strong> to confirm</label>
              <input id="confirm-delete" name="confirm" type="text" autoComplete="off" required />
            </div>
            <button type="submit" className="danger">Delete permanently</button>
          </form>
        </section>
      )}
    </main>
  );
}
