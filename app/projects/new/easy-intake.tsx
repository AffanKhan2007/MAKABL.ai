'use client';

import { useActionState, useTransition, type FormEvent } from 'react';
import type { IntakeState } from './actions.ts';

// Easy mode intake: plain questions and tick boxes, no feature types, models or criteria.
// It fills in the same fields the full form sends, so the server checks it the same way;
// acceptance criteria are each feature type's defaults.

interface Need { key: string; text: string; hint: string; features: Array<{ type: string; name: string }> }

const NEEDS: Need[] = [
  {
    key: 'signin', text: 'People sign in with their own account', hint: 'You, your staff or your customers',
    features: [{ type: 'auth', name: 'Sign-in' }],
  },
  {
    key: 'list', text: 'Keep a list you can add to and change', hint: 'A menu, products, stock, bookings, clients',
    features: [
      { type: 'migration', name: 'Where the list is saved' },
      { type: 'crud_endpoint', name: 'Add, change and remove items' },
      { type: 'form_page', name: 'Add or edit an item' },
    ],
  },
  {
    key: 'page', text: 'A page that shows things at a glance', hint: 'Today’s orders, low stock, a summary',
    features: [{ type: 'page', name: 'Main page' }],
  },
  {
    key: 'form', text: 'A form customers fill in', hint: 'Orders, table bookings, contact requests',
    features: [{ type: 'form_page', name: 'Customer form' }],
  },
  {
    key: 'connect', text: 'Connect to another service', hint: 'Payments, email, maps',
    features: [{ type: 'integration', name: 'Connected service' }],
  },
];

const VISITORS = [
  { value: '50', text: 'Just me and my team' },
  { value: '1000', text: 'Up to 1,000 a month' },
  { value: '10000', text: 'Up to 10,000 a month' },
  { value: '50000', text: 'More than that' },
];

interface Preset { id: string; label: string; blurb: string }

export function EasyIntake({ action, presets }: {
  action: (prev: IntakeState, form: FormData) => Promise<IntakeState>;
  presets: Preset[];
}) {
  const [state, formAction, pending] = useActionState<IntakeState, FormData>(action, { error: null });
  const [, startTransition] = useTransition();

  // Submitted by hand so a validation error does not wipe the form (React resets forms
  // after an action), and so the tick boxes can become the feature rows the server expects.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const easy = new FormData(e.currentTarget);
    const data = new FormData();
    for (const key of ['name', 'idea', 'visitors', 'preset']) data.set(key, String(easy.get(key) ?? ''));
    if (easy.get('business') === 'on') data.set('commercial', 'on');
    data.set('horizon', 'first_month');
    data.set('model', 'anthropic/claude-sonnet-5-5'); // replaced by the preset's build model
    const chosen = NEEDS.filter((n) => easy.get(`need_${n.key}`) === 'on').flatMap((n) => n.features);
    chosen.forEach((f, i) => {
      data.set(`feature_type_${i}`, f.type);
      data.set(`feature_name_${i}`, f.name);
    });
    startTransition(() => formAction(data));
  };

  return (
    <form onSubmit={onSubmit} className="stack">
      <section className="card stack">
        <div>
          <label htmlFor="name">What is your app called?</label>
          <input id="name" name="name" type="text" required maxLength={80} defaultValue="Table bookings" />
        </div>
        <div>
          <label htmlFor="idea">What should it do? <span className="hint">Say it in your own words.</span></label>
          <textarea id="idea" name="idea" required maxLength={2000} rows={3}
            defaultValue="Customers book a table at my restaurant. My staff see today’s bookings and can change or cancel them." />
        </div>
        <label className="check">
          <input type="checkbox" name="business" defaultChecked />
          This is for my business
        </label>
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>What does it need?</h2>
        <p className="muted small" style={{ margin: 0 }}>Tick everything that fits. Each one is built and checked separately.</p>
        <div className="choice-list">
          {NEEDS.map((n) => (
            <label key={n.key} className="choice">
              <input type="checkbox" name={`need_${n.key}`} defaultChecked={n.key !== 'connect'} />
              <span>{n.text}<span className="hint">{n.hint}</span></span>
            </label>
          ))}
        </div>
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>How many people will use it?</h2>
        <div className="choice-list">
          {VISITORS.map((v) => (
            <label key={v.value} className="choice">
              <input type="radio" name="visitors" value={v.value} defaultChecked={v.value === '1000'} />
              <span>{v.text}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>How should we build it?</h2>
        <p className="muted small" style={{ margin: 0 }}>You can change this later and see the price change.</p>
        <div className="choice-list">
          {presets.map((p) => (
            <label key={p.id} className="choice">
              <input type="radio" name="preset" value={p.id} defaultChecked={p.id === 'balanced'} />
              <span>{p.label}<span className="hint">{p.blurb}</span></span>
            </label>
          ))}
        </div>
      </section>

      {state.error && <p className="notice bad" role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>{pending ? 'Working out the price…' : 'Show me what it costs'}</button>
      <p className="muted small" style={{ margin: 0 }}>Nothing is built or charged until you say so.</p>
    </form>
  );
}
