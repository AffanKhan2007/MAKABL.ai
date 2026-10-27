'use client';

import { useActionState } from 'react';
import { FEATURE_TYPES } from '../../format.ts';
import { createProjectAction, type IntakeState } from './actions.ts';

const EXAMPLE = [
  { type: 'auth', name: 'Shop owner sign-in' },
  { type: 'migration', name: 'Items and stock schema' },
  { type: 'crud_endpoint', name: 'Items API' },
  { type: 'form_page', name: 'Add or edit item' },
  { type: 'page', name: 'Low-stock dashboard' },
];

export function IntakeForm({ rows, models }: { rows: number; models: ReadonlyArray<{ id: string; label: string }> }) {
  const [state, action, pending] = useActionState<IntakeState, FormData>(createProjectAction, { error: null });

  return (
    <form action={action} className="stack">
      <section className="card stack">
        <div>
          <label htmlFor="name">Project name</label>
          <input id="name" name="name" type="text" required maxLength={80} defaultValue="Inventory tracker" />
        </div>
        <div>
          <label htmlFor="idea">What should it do? <span className="hint">Who uses it and for what.</span></label>
          <textarea id="idea" name="idea" required maxLength={2000}
            defaultValue="An inventory tracker for a small shop: the owner signs in, adds items with stock levels, and sees which items are running low." />
        </div>
        <label className="check">
          <input type="checkbox" name="commercial" defaultChecked />
          This is paid or client work <span className="hint">(free hosting tiers that ban commercial use are ruled out)</span>
        </label>
      </section>

      <section className="card">
        <h2>Features</h2>
        <p className="muted small" style={{ marginTop: -6 }}>Each feature is built and checked separately, and priced on its own line. Leave rows blank to skip them.</p>
        {Array.from({ length: rows }, (_, i) => (
          <div className="feature-row" key={i}>
            <select name={`feature_type_${i}`} aria-label={`Feature ${i + 1} type`} defaultValue={EXAMPLE[i]?.type ?? 'page'}>
              {FEATURE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <input type="text" name={`feature_name_${i}`} aria-label={`Feature ${i + 1} name`} maxLength={80}
              placeholder="Feature name" defaultValue={EXAMPLE[i]?.name ?? ''} />
          </div>
        ))}
      </section>

      <section className="card grid2">
        <div>
          <label htmlFor="visitors">Expected visitors per month <span className="hint">(optional)</span></label>
          <input id="visitors" name="visitors" type="number" min={0} max={100000000} step={1} defaultValue={2000} />
        </div>
        <div>
          <label htmlFor="horizon">Plan covers</label>
          <select id="horizon" name="horizon" defaultValue="first_month">
            <option value="build_only">The build only</option>
            <option value="first_month">Build + first month of hosting</option>
            <option value="first_12_months">Build + first 12 months of hosting</option>
          </select>
        </div>
        <div>
          <label htmlFor="model">Build model</label>
          <select id="model" name="model" defaultValue={models[0]?.id}>
            {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="unpriced">Costs you know of but can't price <span className="hint">(comma-separated)</span></label>
          <input id="unpriced" name="unpriced" type="text" defaultValue="Custom domain" />
        </div>
      </section>

      {state.error && <p className="notice bad" role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>{pending ? 'Working out the plan…' : 'Get the cost plan'}</button>
    </form>
  );
}
