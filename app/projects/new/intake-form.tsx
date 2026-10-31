'use client';

import { useActionState, useState, useTransition, type FormEvent } from 'react';
import type { ProjectSpec } from '../../../src/server/projects.ts';
import { FEATURE_TYPES } from '../../format.ts';
import type { IntakeState } from './actions.ts';

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
  const spec = initial?.spec ?? EXAMPLE;

  // Submitted from onSubmit rather than <form action>, which React resets after every
  // submission: a validation error must not wipe everything the user typed.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };

  return (
    <form onSubmit={onSubmit} className="stack">
      <section className="card stack">
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

      <section className="card">
        <h2>Features</h2>
        <p className="muted small" style={{ marginTop: -6 }}>
          Each feature is built and checked separately, priced on its own line, and judged against its acceptance
          criteria. Leave rows blank to skip them.
        </p>
        {Array.from({ length: rows }, (_, i) => (
          <FeatureRow key={i} i={i} initial={spec.features[i]} defaults={defaults} />
        ))}
      </section>

      <section className="card grid2">
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
          <label htmlFor="model">Build model</label>
          <select id="model" name="model" defaultValue={spec.buildModel}>
            {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="unpriced">Costs you know of but can't price <span className="hint">(comma-separated)</span></label>
          <input id="unpriced" name="unpriced" type="text" defaultValue={spec.unpricedItems.join(', ')} />
        </div>
      </section>

      {state.error && <p className="notice bad" role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>{pending ? 'Working out the plan…' : submitLabel}</button>
    </form>
  );
}
