'use client';

import { useActionState, useRef, useState, useTransition, type FormEvent } from 'react';
import type { ProjectSpec } from '../../../src/server/projects.ts';
import { FEATURE_TYPES } from '../../format.ts';
import type { IntakeState } from './actions.ts';
import { WizardActions, WizardProgress } from './wizard-ui.tsx';

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
};

interface Props {
  action: (prev: IntakeState, form: FormData) => Promise<IntakeState>;
  rows: number;
  models: ReadonlyArray<{ id: string; label: string }>;
  /** Default acceptance criteria per feature type, shown as placeholders. */
  defaults: Record<string, string[]>;
  initial?: { name: string; spec: ProjectSpec };
  submitLabel: string;
}

/** True when criteria are exactly the type's defaults, so the box can stay empty. */
const isDefault = (criteria: string[], defaults: string[] | undefined) =>
  !!defaults && criteria.length === defaults.length && criteria.every((c, i) => c === defaults[i]);

function FeatureRow({ i, initial, defaults }: {
  i: number; initial?: ProjectSpec['features'][number]; defaults: Record<string, string[]>;
}) {
  const [type, setType] = useState<string>(initial?.type ?? 'page');
  const criteria = initial && !isDefault(initial.acceptance, defaults[initial.type]) ? initial.acceptance.join('\n') : '';
  return (
    <div className="feature-block">
      <div className="feature-row">
        <select name={`feature_type_${i}`} aria-label={`Feature ${i + 1} type`} value={type} onChange={(e) => setType(e.target.value)}>
          {FEATURE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input type="text" name={`feature_name_${i}`} aria-label={`Feature ${i + 1} name`} maxLength={80}
          placeholder="Feature name" defaultValue={initial?.name ?? ''} />
      </div>
      <details open={!!criteria}>
        <summary className="small muted">Acceptance criteria {criteria ? '(custom)' : '(defaults for this type)'}</summary>
        <textarea name={`feature_criteria_${i}`} aria-label={`Feature ${i + 1} acceptance criteria`} rows={3}
          defaultValue={criteria} placeholder={(defaults[type] ?? []).join('\n')} />
        <p className="hint" style={{ margin: '2px 0 0' }}>One per line. Leave empty to use the defaults shown.</p>
      </details>
    </div>
  );
}

export function IntakeForm({ action, rows, models, defaults, initial, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState<IntakeState, FormData>(action, { error: null });
  const [, startTransition] = useTransition();
  const [step, setStep] = useState(1);
  const formRef = useRef<HTMLFormElement>(null);
  const spec = initial?.spec ?? EXAMPLE;

  // Submitted from onSubmit rather than <form action>, which React resets after every
  // submission: a validation error must not wipe everything the user typed.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };

  const continueStep = () => {
    const invalid = formRef.current?.querySelector<HTMLElement>(`[data-step="${step}"] :invalid`);
    if (invalid instanceof HTMLInputElement || invalid instanceof HTMLTextAreaElement || invalid instanceof HTMLSelectElement) {
      invalid.reportValidity();
      return;
    }
    setStep((current) => Math.min(4, current + 1));
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className="stack wizard-form" data-current-step={step}>
      <WizardProgress step={step} />
      <section className="card stack wizard-panel" data-wizard-panel data-step="1">
        <div className="wizard-panel-heading">
          <span className="eyebrow">Step 1 · Describe</span>
          <h2>Start with the idea</h2>
          <p className="muted small">Give your project a name and a short description of what it should do.</p>
        </div>
        <div>
          <label htmlFor="name">Project name</label>
          <input id="name" name="name" type="text" required maxLength={80} defaultValue={initial?.name ?? 'Inventory tracker'} />
        </div>
        <div>
          <label htmlFor="idea">What should it do? <span className="hint">Who uses it and for what.</span></label>
          <textarea id="idea" name="idea" required maxLength={2000} defaultValue={spec.idea} />
        </div>
        <label className="check">
          <input type="checkbox" name="commercial" defaultChecked={spec.commercialUse} />
          This is paid or client work <span className="hint">(free hosting tiers that ban commercial use are ruled out)</span>
        </label>
      </section>

      <section className="card stack wizard-panel" data-wizard-panel data-step="2">
        <div className="wizard-panel-heading">
          <span className="eyebrow">Step 2 · Features</span>
          <h2>Break it into features</h2>
          <p className="muted small">Each feature is built and checked separately, priced on its own line, and judged against its acceptance criteria. Leave rows blank to skip them.</p>
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <FeatureRow key={i} i={i} initial={spec.features[i]} defaults={defaults} />
        ))}
      </section>

      <section className="card stack wizard-panel" data-wizard-panel data-step="3">
        <div className="wizard-panel-heading">
          <span className="eyebrow">Step 3 · Usage</span>
          <h2>Set the planning assumptions</h2>
          <p className="muted small">These details help shape a useful cost range. Visitor numbers are optional.</p>
        </div>
        <div className="grid2">
          <div>
            <label htmlFor="visitors">Expected visitors per month <span className="hint">(optional)</span></label>
            <input id="visitors" name="visitors" type="number" min={0} max={100000000} step={1}
              defaultValue={spec.monthlyVisitors ?? ''} />
          </div>
          <div>
            <label htmlFor="horizon">Plan covers</label>
            <select id="horizon" name="horizon" defaultValue={spec.horizon}>
              <option value="build_only">The build only</option>
              <option value="first_month">Build + first month of hosting</option>
              <option value="first_12_months">Build + first 12 months of hosting</option>
            </select>
          </div>
          <div>
            <label htmlFor="unpriced">Costs you know of but can't price <span className="hint">(comma-separated)</span></label>
            <input id="unpriced" name="unpriced" type="text" defaultValue={spec.unpricedItems.join(', ')} />
          </div>
        </div>
      </section>

      <section className="card stack wizard-panel" data-wizard-panel data-step="4">
        <div className="wizard-panel-heading">
          <span className="eyebrow">Step 4 · Build</span>
          <h2>Choose a build model</h2>
          <p className="muted small">You’ll review the cost plan before anything is built or spent.</p>
        </div>
        <div>
          <label htmlFor="model">Build model</label>
          <select id="model" name="model" defaultValue={spec.buildModel}>
            {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
      </section>

      {state.error && <p className="notice bad" role="alert">{state.error}</p>}
      <WizardActions step={step} onPrevious={() => setStep((current) => Math.max(1, current - 1))}
        onContinue={continueStep} pending={pending} submitLabel={pending ? 'Working out the plan…' : submitLabel} />
    </form>
  );
}
