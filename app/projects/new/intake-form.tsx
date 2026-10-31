'use client';

import { useActionState, useMemo, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import type { ProjectSpec } from '../../../src/server/projects.ts';
import { FEATURE_TYPES } from '../../format.ts';
import type { IntakeState } from './actions.ts';
import { WizardActions, WizardProgress } from './wizard-ui.tsx';

// Pro mode: one screen per step, a little text on each, every control a person might want.
// All steps stay mounted (the inactive ones are hidden) so nothing typed is lost moving
// between them, and the form is submitted by hand so a validation error never wipes it.

const STEPS = ['Describe', 'Features', 'Models', 'Plan', 'Review'] as const;
const MAX_FEATURES = 8;

const EXAMPLE: ProjectSpec = {
  idea: 'An inventory tracker for a small shop: the owner signs in, adds items with stock levels, and sees which items are running low.',
  features: [
    { type: 'auth', name: 'Shop owner sign-in', acceptance: [] },
    { type: 'migration', name: 'Items and stock schema', acceptance: [] },
    { type: 'crud_endpoint', name: 'Items API', acceptance: [] },
    { type: 'form_page', name: 'Add or edit item', acceptance: [] },
    { type: 'page', name: 'Low-stock dashboard', acceptance: [] },
  ],
  commercialUse: true,
  horizon: 'first_month',
  monthlyVisitors: 2000,
  buildModel: 'google/gemini-3.6-flash',
  unpricedItems: ['Custom domain'],
  relay: { spec: 'google/gemini-3.5-flash-lite', architect: 'google/gemini-3.6-flash', review: 'google/gemini-3.5-flash-lite' },
};

interface Model { id: string; label: string; vendor: string; lifecycle?: string; input: number; output: number }
interface Preset {
  label: string; blurb: string; buildModel: string; retryRate: number | null;
  relay: { spec: string; architect: string; review: string };
}

interface Props {
  action: (prev: IntakeState, form: FormData) => Promise<IntakeState>;
  rows: number;
  models: ReadonlyArray<Model>;
  /** Default acceptance criteria per feature type, shown as placeholders. */
  defaults: Record<string, string[]>;
  initial?: { name: string; spec: ProjectSpec };
  submitLabel: string;
  presets?: Record<string, Preset>;
}

const PHASES = [
  { key: 'spec', name: 'Spec', job: 'Turns the idea into a brief', hint: 'A small, cheap model is enough.', field: 'model_spec' },
  { key: 'architect', name: 'Architect', job: 'Draws the wireframe, data and files', hint: 'Worth a stronger model.', field: 'model_architect' },
  { key: 'build', name: 'Build', job: 'Writes and checks each feature', hint: 'Where most of the money goes.', field: 'model' },
  { key: 'review', name: 'Review', job: 'Reads the result against the criteria', hint: 'A small model works well.', field: 'model_review' },
] as const;
type PhaseKey = typeof PHASES[number]['key'];

const RETRIES = [
  { value: '0', label: 'None', hint: 'Best case' },
  { value: '0.25', label: 'A few', hint: '' },
  { value: '0.5', label: 'Some', hint: 'Default' },
  { value: '1', label: 'One each', hint: 'Cautious' },
  { value: '2', label: 'Two each', hint: 'Worst case' },
];
const HORIZONS = [
  { value: 'build_only', label: 'Build only' },
  { value: 'first_month', label: '+ first month' },
  { value: 'first_12_months', label: '+ 12 months' },
];

const perM = (micros: number) => `$${(micros / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 3 })}`;
const suits = (phase: PhaseKey, m: Model) => !m.lifecycle && (phase === 'spec' || phase === 'review'
  ? m.output <= 5_000_000
  : m.output >= 5_000_000 && m.output <= 50_000_000);

/** True when criteria are exactly the type's defaults, so the box can stay empty. */
const isDefault = (criteria: string[], defaults: string[] | undefined) =>
  !!defaults && criteria.length === defaults.length && criteria.every((c, i) => c === defaults[i]);

interface FeatureDraft { id: number; type: string; name: string; criteria: string }

/** A switch: a checkbox that looks like one, so it submits like any other field. */
function Switch({ name, defaultChecked, onChange, children }: {
  name: string; defaultChecked: boolean; onChange?: (on: boolean) => void; children: ReactNode;
}) {
  return (
    <label className="pw-switch">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} onChange={(e) => onChange?.(e.target.checked)} />
      <span className="pw-switch-track" aria-hidden><span className="pw-switch-thumb" /></span>
      <span>{children}</span>
    </label>
  );
}

/** Pill choices: radio inputs, so they submit and are keyboard-accessible. */
function Pills({ name, options, defaultValue }: {
  name: string; options: Array<{ value: string; label: string; hint?: string }>; defaultValue: string;
}) {
  return (
    <div className="pw-pills" role="radiogroup">
      {options.map((o) => (
        <label key={o.value} className="pw-pill">
          <input type="radio" name={name} value={o.value} defaultChecked={o.value === defaultValue} />
          <span>{o.label}{o.hint ? <small>{o.hint}</small> : null}</span>
        </label>
      ))}
    </div>
  );
}

export function IntakeForm({ action, models, defaults, initial, submitLabel, presets }: Props) {
  const [state, formAction, pending] = useActionState<IntakeState, FormData>(action, { error: null });
  const [, startTransition] = useTransition();
  const spec = initial?.spec ?? EXAMPLE;
  const formRef = useRef<HTMLFormElement>(null);

  const [step, setStep] = useState(1);
  const [dir, setDir] = useState<1 | -1>(1);
  const [relayOn, setRelayOn] = useState(!!spec.relay || !initial);
  const nextId = useRef(spec.features.length);
  const [features, setFeatures] = useState<FeatureDraft[]>(() => spec.features.map((f, i) => ({
    id: i, type: f.type, name: f.name, criteria: isDefault(f.acceptance, defaults[f.type]) ? '' : f.acceptance.join('\n'),
  })));
  const [name, setName] = useState(initial?.name ?? 'Inventory tracker');
  const [picked, setPicked] = useState<Record<PhaseKey, string>>({
    spec: spec.relay?.spec ?? EXAMPLE.relay!.spec,
    architect: spec.relay?.architect ?? EXAMPLE.relay!.architect,
    build: spec.buildModel,
    review: spec.relay?.review ?? EXAMPLE.relay!.review,
  });

  const label = (id: string) => models.find((m) => m.id === id)?.label ?? id;
  const filled = features.filter((f) => f.name.trim());
  const retry = String(spec.retryRate ?? 0.5);
  const retryLabel = useMemo(() => RETRIES.find((r) => r.value === retry)?.label ?? 'Some', [retry]);

  const go = (to: number) => { setDir(to > step ? 1 : -1); setStep(to); };

  const validateStep = (): boolean => {
    const bad = formRef.current?.querySelector<HTMLElement>(`[data-step="${step}"] :invalid`);
    if (bad instanceof HTMLInputElement || bad instanceof HTMLTextAreaElement || bad instanceof HTMLSelectElement) {
      bad.reportValidity();
      return false;
    }
    if (step === 2 && filled.length === 0) return false;
    return true;
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (step < STEPS.length) return;
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };

  const applyPreset = (p: Preset) => {
    setPicked({ spec: p.relay.spec, architect: p.relay.architect, build: p.buildModel, review: p.relay.review });
    setRelayOn(true);
  };

  const setFeature = (id: number, patch: Partial<FeatureDraft>) =>
    setFeatures((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  return (
    <form ref={formRef} onSubmit={onSubmit} className="pw" noValidate>
      <input type="hidden" name="pro_options" value="1" />
      <WizardProgress step={step} steps={STEPS} />

      <div className="pw-stage" data-dir={dir}>
        {/* 1 · Describe */}
        <section className="pw-panel" data-step="1" hidden={step !== 1}>
          <header className="pw-head"><span className="eyebrow">Step 1 of 5</span><h2>What are we building?</h2></header>
          <div className="pw-field">
            <label htmlFor="name">Project name</label>
            <input id="name" name="name" type="text" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="pw-field">
            <label htmlFor="idea">In a sentence or two: who uses it, and for what?</label>
            <textarea id="idea" name="idea" required maxLength={2000} rows={5} defaultValue={spec.idea} />
          </div>
          <Switch name="commercial" defaultChecked={spec.commercialUse}>
            Paid or client work <small>Rules out free hosting plans that ban commercial use.</small>
          </Switch>
        </section>

        {/* 2 · Features */}
        <section className="pw-panel" data-step="2" hidden={step !== 2}>
          <header className="pw-head"><span className="eyebrow">Step 2 of 5</span><h2>Break it into features</h2>
            <p>Each is built, priced and checked on its own.</p></header>
          <ul className="pw-features">
            {features.map((f, i) => (
              <li key={f.id} className="pw-feature" style={{ ['--i' as string]: Math.min(i, 8) }}>
                <input type="hidden" name={`feature_type_${i}`} value={f.type} />
                <div className="pw-feature-top">
                  <span className="pw-feature-num" aria-hidden>{i + 1}</span>
                  <input type="text" name={`feature_name_${i}`} aria-label={`Feature ${i + 1} name`} maxLength={80}
                    placeholder="Name this feature" value={f.name} onChange={(e) => setFeature(f.id, { name: e.target.value })} />
                  <button type="button" className="pw-icon-btn" aria-label={`Remove feature ${i + 1}`}
                    onClick={() => setFeatures((fs) => fs.filter((x) => x.id !== f.id))}>×</button>
                </div>
                <div className="pw-chips" role="radiogroup" aria-label={`Feature ${i + 1} type`}>
                  {FEATURE_TYPES.map((t) => (
                    <button key={t.value} type="button" role="radio" aria-checked={f.type === t.value}
                      className="pw-chip" onClick={() => setFeature(f.id, { type: t.value })}>{t.label}</button>
                  ))}
                </div>
                <details className="pw-more" open={!!f.criteria}>
                  <summary>{f.criteria ? 'Custom checks' : 'Checks: defaults for this type'}</summary>
                  <textarea name={`feature_criteria_${i}`} aria-label={`Feature ${i + 1} acceptance criteria`} rows={3}
                    value={f.criteria} onChange={(e) => setFeature(f.id, { criteria: e.target.value })}
                    placeholder={(defaults[f.type] ?? []).join('\n')} />
                  <p className="hint">One per line. Leave empty to use the defaults shown.</p>
                </details>
              </li>
            ))}
          </ul>
          <div className="pw-add-row">
            <button type="button" className="secondary" disabled={features.length >= MAX_FEATURES}
              onClick={() => { setFeatures((fs) => [...fs, { id: nextId.current++, type: 'page', name: '', criteria: '' }]); }}>
              + Add a feature
            </button>
            <span className="muted small num">{filled.length} of {MAX_FEATURES}</span>
          </div>
          {filled.length === 0 && <p className="notice warn small" role="status">Add at least one feature to continue.</p>}
        </section>

        {/* 3 · Models */}
        <section className="pw-panel" data-step="3" hidden={step !== 3}>
          <header className="pw-head"><span className="eyebrow">Step 3 of 5</span><h2>Who does each job?</h2>
            <p>Each phase can run on a different model, from any vendor.</p></header>
          {presets && (
            <div className="pw-presets" aria-label="Quick setups">
              {Object.entries(presets).map(([id, p]) => (
                <button key={id} type="button" className="pw-preset" onClick={() => applyPreset(p)}>
                  <strong>{p.label}</strong><small>{p.blurb}</small>
                </button>
              ))}
            </div>
          )}
          <Switch name="relay" defaultChecked={relayOn} onChange={setRelayOn}>
            Run as a relay <small>Spec, architect and review get their own models and hand off short briefs.</small>
          </Switch>
          <div className="pw-phases" data-relay={relayOn ? 'on' : 'off'}>
            {PHASES.map((ph, i) => {
              const off = ph.key !== 'build' && !relayOn;
              return (
                <div key={ph.key} className={`pw-phase${off ? ' off' : ''}`} style={{ ['--i' as string]: i }}>
                  <div className="pw-phase-head"><span className="pw-phase-name">{ph.name}</span><span className="muted small">{ph.job}</span></div>
                  <select name={ph.field} value={picked[ph.key]} disabled={off} aria-label={`${ph.name} model`}
                    onChange={(e) => setPicked((p) => ({ ...p, [ph.key]: e.target.value }))}>
                    {['Anthropic', 'OpenAI', 'Google'].flatMap((v) => [false, true].map((older) => {
                      const group = models.filter((m) => m.vendor === v && !!m.lifecycle === older);
                      return group.length ? (
                        <optgroup key={`${v}-${older}`} label={older ? `${v}: older and preview` : v}>
                          {group.map((m) => (
                            <option key={m.id} value={m.id}>
                              {suits(ph.key, m) ? '★ ' : ''}{m.label} · {perM(m.input)} / {perM(m.output)}
                            </option>
                          ))}
                        </optgroup>
                      ) : null;
                    }))}
                  </select>
                  <span className="hint">{ph.hint}</span>
                </div>
              );
            })}
          </div>
          <p className="hint">★ suits that phase by price and generation. Prices are per 1M tokens, input / output.</p>
        </section>

        {/* 4 · Plan */}
        <section className="pw-panel" data-step="4" hidden={step !== 4}>
          <header className="pw-head"><span className="eyebrow">Step 4 of 5</span><h2>Shape the plan</h2>
            <p>These move the cost range. You can change them later and watch it update.</p></header>
          <div className="pw-field"><label>What should the plan cover?</label><Pills name="horizon" options={HORIZONS} defaultValue={spec.horizon} /></div>
          <div className="pw-field">
            <label htmlFor="visitors">Visitors per month <small className="hint">optional</small></label>
            <input id="visitors" name="visitors" type="number" min={0} max={100000000} step={1} inputMode="numeric"
              defaultValue={spec.monthlyVisitors ?? ''} placeholder="for example 2000" />
          </div>
          <div className="pw-field"><label>How many retries to plan for?</label><Pills name="retry" options={RETRIES} defaultValue={retry} /></div>
          <Switch name="caching" defaultChecked={spec.caching !== false}>
            Prompt caching <small>Reuses repeated context. Turning it off raises the build cost.</small>
          </Switch>
          <div className="pw-field">
            <label htmlFor="unpriced">Costs you know of but can&rsquo;t price <small className="hint">comma-separated</small></label>
            <input id="unpriced" name="unpriced" type="text" defaultValue={spec.unpricedItems.join(', ')} placeholder="Custom domain, payments" />
          </div>
        </section>

        {/* 5 · Review */}
        <section className="pw-panel" data-step="5" hidden={step !== 5}>
          <header className="pw-head"><span className="eyebrow">Step 5 of 5</span><h2>Ready to price it?</h2>
            <p>Nothing is built or charged yet. You see the full plan and set a limit next.</p></header>
          <dl className="pw-summary">
            <div><dt>Project</dt><dd>{name || 'Untitled'}</dd></div>
            <div><dt>Features</dt><dd>{filled.length}: {filled.map((f) => f.name).join(', ') || 'none'}</dd></div>
            <div><dt>Models</dt><dd>
              {relayOn
                ? <span className="pw-chain">{PHASES.map((ph) => <span key={ph.key}><b>{ph.name}</b> {label(picked[ph.key])}</span>)}</span>
                : <span><b>Build</b> {label(picked.build)} <span className="muted">(no relay)</span></span>}
            </dd></div>
            <div><dt>Retries</dt><dd>{retryLabel}</dd></div>
          </dl>
        </section>
      </div>

      {state.error && <p className="notice bad" role="alert">{state.error}</p>}
      <WizardActions step={step} total={STEPS.length} pending={pending}
        onPrevious={() => go(Math.max(1, step - 1))}
        onContinue={() => { if (validateStep()) go(Math.min(STEPS.length, step + 1)); }}
        submitLabel={pending ? 'Working out the plan…' : submitLabel} />
    </form>
  );
}
