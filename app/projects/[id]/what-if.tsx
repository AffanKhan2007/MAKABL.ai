'use client';

import { useActionState, useRef, useState, useTransition, type FormEvent } from 'react';
import type { Phase } from '../../../src/estimator/estimator.ts';
import type { WhatIfState } from '../../../src/server/what-if.ts';
import { money, range } from '../../format.ts';

// What-if explorer (#21). Every change recomputes the plan on the server and shows what it
// trades away; nothing is saved until "Apply". Submitted by hand, not through <form action>,
// because React resets a form after each action and that would undo the user's choices.

interface Model { id: string; label: string; vendor: string; lifecycle?: string; input: number; output: number }

/**
 * Which models to suggest for a phase, by price and generation only: short single passes
 * (spec, review) suit small models; architecture and building suit strong ones.
 */
const suits = (phase: Phase, m: Model) => !m.lifecycle && (phase === 'spec' || phase === 'review'
  ? m.output <= 5_000_000
  : m.output >= 5_000_000 && m.output <= 50_000_000);
const perM = (micros: number) => `$${(micros / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 3 })}`;
const optionText = (m: Model, suggested: boolean) =>
  `${suggested ? '★ ' : ''}${m.label} · ${perM(m.input)} / ${perM(m.output)}${m.lifecycle ? ` · ${m.lifecycle}` : ''}`;

interface Props {
  action: (prev: WhatIfState, form: FormData) => Promise<WhatIfState>;
  apply: (form: FormData) => Promise<void>;
  initial: WhatIfState;
  models: readonly Model[];
  defaults: {
    relay: Record<Exclude<Phase, 'build'>, string>;
    relayOn: boolean;
    buildModel: string;
    retryRate: number;
    caching: boolean;
    commercialUse: boolean;
    horizon: string;
    monthlyVisitors: number | null;
  };
  retryChoices: readonly number[];
  today: string;
  canApply: boolean;
  nextVersion: number;
}

const PHASE_TEXT: Record<Phase, { name: string; job: string }> = {
  spec: { name: 'Spec', job: 'turns the idea into a brief' },
  architect: { name: 'Architect', job: 'draws the wireframe and plans data and files' },
  build: { name: 'Build', job: 'writes and checks each feature' },
  review: { name: 'Review', job: 'checks each feature against its criteria' },
};
const VENDOR_CLASS: Record<string, string> = {
  Anthropic: 'v-anthropic', OpenAI: 'v-openai', Google: 'v-google', Groq: 'v-openai', OpenRouter: 'v-google', Mistral: 'v-anthropic', Qwen: 'v-qwen',
};
const TONE = { block: 'bad', warn: 'warn', info: 'accent' } as const;
const SEVERITY_TEXT = { block: 'Blocker', warn: 'Trade-off', info: 'Shortcoming' } as const;

export function WhatIf({ action, apply, initial, models, defaults, retryChoices, today, canApply, nextVersion }: Props) {
  const [state, dispatch, pending] = useActionState(action, initial);
  const [applying, startApply] = useTransition();
  const [, startTransition] = useTransition();
  const [relayOn, setRelayOn] = useState(defaults.relayOn);
  const [dirty, setDirty] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const r = state.result;

  const recompute = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!formRef.current) return;
      const data = new FormData(formRef.current);
      startTransition(() => dispatch(data));
    }, 150);
  };
  const onChange = (e: FormEvent<HTMLFormElement>) => {
    if ((e.target as HTMLInputElement).name === 'relay') setRelayOn((e.target as HTMLInputElement).checked);
    setDirty(true);
    recompute();
  };
  const onSubmit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); recompute(); };
  const onApply = () => {
    if (!formRef.current) return;
    const data = new FormData(formRef.current);
    startApply(() => apply(data));
  };
  const onReset = () => {
    formRef.current?.reset();
    setRelayOn(defaults.relayOn);
    setDirty(false);
    recompute();
  };

  const phaseSelect = (phase: Phase) => {
    const name = `model_${phase}`;
    const value = phase === 'build' ? defaults.buildModel : defaults.relay[phase];
    const disabled = phase !== 'build' && !relayOn;
    return (
      <div className={`relay-node${disabled ? ' off' : ''}`} key={phase}>
        <div className="relay-step">{PHASE_TEXT[phase].name}</div>
        <select name={name} defaultValue={value} disabled={disabled} aria-label={`${PHASE_TEXT[phase].name} model`}>
          {['Anthropic', 'OpenAI', 'Google', 'Groq', 'OpenRouter', 'Mistral', 'Qwen'].flatMap((v) => [false, true].map((older) => {
            const group = models.filter((m) => m.vendor === v && !!m.lifecycle === older);
            return group.length ? (
              <optgroup key={`${v}-${older}`} label={older ? `${v}: older and preview` : v}>
                {group.map((m) => <option key={m.id} value={m.id}>{optionText(m, suits(phase, m))}</option>)}
              </optgroup>
            ) : null;
          }))}
        </select>
        <div className="relay-job">{PHASE_TEXT[phase].job}</div>
      </div>
    );
  };

  const total = r ? r.modelCost.expected || 1 : 1;
  const blockers = r?.conflicts.filter((c) => c.severity === 'block').length ?? 0;
  const tradeoffs = r?.conflicts.filter((c) => c.severity === 'warn').length ?? 0;

  return (
    <section className="card stack what-if" aria-busy={pending}>
      <div className="row spread">
        <div>
          <span className="eyebrow">Model relay · what if</span>
          <h2 style={{ margin: '4px 0 0' }}>Pick a model per phase, see the cost and the catch</h2>
        </div>
        <span className={`badge ${pending ? 'accent' : blockers ? 'bad' : tradeoffs ? 'warn' : 'good'}`}>
          {pending ? 'Recomputing…' : blockers ? `${blockers} blocker${blockers > 1 ? 's' : ''}` : tradeoffs ? `${tradeoffs} trade-off${tradeoffs > 1 ? 's' : ''}` : 'No conflicts'}
        </span>
      </div>

      <form ref={formRef} onChange={onChange} onSubmit={onSubmit} className="stack">
        <label className="check" style={{ margin: 0 }}>
          <input type="checkbox" name="relay" defaultChecked={defaults.relayOn} />
          Run as a relay <span className="hint">(each phase on its own model, handing the next a short brief)</span>
        </label>
        <p className="hint" style={{ margin: 0 }}>
          {models.length} models from Anthropic, OpenAI and Google. Prices are per 1M tokens, input / output. ★ marks models
          suited to that phase by price and generation.
        </p>
        <div className="relay">
          {(['spec', 'architect', 'build', 'review'] as const).map(phaseSelect)}
        </div>

        <div className="what-if-knobs">
          <div>
            <label htmlFor="wi-retry">Extra attempts per feature</label>
            <select id="wi-retry" name="retry" defaultValue={String(defaults.retryRate)}>
              {retryChoices.map((c) => <option key={c} value={String(c)}>{c}{c === 0.5 ? ' (default)' : ''}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="wi-date">Build date</label>
            <input id="wi-date" name="build_date" type="date" min={today} defaultValue={today} />
          </div>
          <div>
            <label htmlFor="wi-horizon">Plan covers</label>
            <select id="wi-horizon" name="horizon" defaultValue={defaults.horizon}>
              <option value="build_only">Build only</option>
              <option value="first_month">+ first month</option>
              <option value="first_12_months">+ first 12 months</option>
            </select>
          </div>
          <div>
            <label htmlFor="wi-visitors">Visitors / month</label>
            <input id="wi-visitors" name="visitors" type="number" min={0} max={100000000} step={1}
              defaultValue={defaults.monthlyVisitors ?? ''} placeholder="none" />
          </div>
          <label className="check"><input type="checkbox" name="caching" defaultChecked={defaults.caching} /> Prompt caching</label>
          <label className="check"><input type="checkbox" name="commercial" defaultChecked={defaults.commercialUse} /> Paid or client work</label>
        </div>
      </form>

      {state.error && <p className="notice bad" role="alert" style={{ margin: 0 }}>{state.error}</p>}

      {r && (
        <>
          <div className="what-if-totals">
            <div>
              <div className="kpi-label">Model cost</div>
              <div className="kpi-value">{money(r.modelCost.expected)}</div>
              <div className="kpi-note num">{range(r.modelCost)}</div>
            </div>
            <div>
              <div className="kpi-label">Paid path total</div>
              <div className="kpi-value">{money(r.paid.totals.expected)}</div>
              <div className={`kpi-note num ${r.delta > 0 ? 't-warn' : r.delta < 0 ? 't-good' : ''}`}>
                {r.delta === 0 ? 'same as saved plan' : `${r.delta > 0 ? '+' : '−'}${money(Math.abs(r.delta))} vs saved plan`}
              </div>
            </div>
            <div>
              <div className="kpi-label">Saved by briefs</div>
              <div className="kpi-value">{r.handoffs.length ? money(r.handoffSavings) : '—'}</div>
              <div className="kpi-note">{r.handoffs.length ? 'vs passing full transcripts' : 'relay off'}</div>
            </div>
          </div>

          <div>
            <div className="relay-bar" role="img" aria-label="Model cost by phase">
              {r.phases.map((p) => (
                <span key={p.phase} className={VENDOR_CLASS[p.vendor] ?? ''}
                  style={{ width: `${Math.max(2, (p.range.expected / total) * 100)}%` }}
                  title={`${PHASE_TEXT[p.phase].name}: ${p.label} ${money(p.range.expected)}`} />
              ))}
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Phase</th><th>Model</th><th className="r">Low – high</th><th className="r">Expected</th></tr></thead>
                <tbody>
                  {r.phases.map((p) => (
                    <tr key={p.phase}>
                      <td>{PHASE_TEXT[p.phase].name}</td>
                      <td><span className={`vendor-dot ${VENDOR_CLASS[p.vendor] ?? ''}`} />{p.label} <span className="muted small">{p.vendor}</span></td>
                      <td className="r num">{range(p.range)}</td>
                      <td className="r num">{money(p.range.expected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {r.handoffs.length > 0 && (
            <div className="handoffs">
              {r.handoffs.map((h) => (
                <div key={`${h.from}-${h.to}`} className="handoff">
                  <div className="small"><strong>{PHASE_TEXT[h.from].name} → {PHASE_TEXT[h.to].name}</strong>{h.crossVendor && <span className="badge" style={{ marginLeft: 8 }}>cross-vendor</span>}</div>
                  <div className="muted small num">{(h.transcriptTokens / 1000).toFixed(1)}K-token history → {(h.briefTokens / 1000).toFixed(0)}K brief · saves {money(h.saved)}</div>
                </div>
              ))}
            </div>
          )}

          <div>
            <h3 style={{ marginBottom: 8 }}>Conflicts and shortcomings</h3>
            {r.conflicts.length === 0 && <p className="muted small" style={{ margin: 0 }}>None for these settings.</p>}
            <ul className="conflicts">
              {r.conflicts.map((c) => (
                <li key={c.id} className={`conflict c-${c.severity}`}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className={`badge ${TONE[c.severity]}`}>{SEVERITY_TEXT[c.severity]}</span>
                    <strong>{c.title}</strong>
                  </div>
                  <p className="small" style={{ margin: '4px 0 0' }}>{c.detail}</p>
                  {c.fix && <p className="small muted" style={{ margin: '2px 0 0' }}>Fix: {c.fix}</p>}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      <div className="row">
        <button type="button" onClick={onApply} disabled={!canApply || !dirty || applying || pending || !!state.error}>
          {applying ? 'Saving…' : `Apply as spec v${nextVersion}`}
        </button>
        <button type="button" className="secondary" onClick={onReset} disabled={!dirty}>Reset</button>
        <span className="muted small">
          {canApply ? 'Applying saves a new spec version; the plan then needs approving again.' : 'Wait for the build to stop before changing the plan.'}
        </span>
      </div>
    </section>
  );
}
