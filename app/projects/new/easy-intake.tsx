'use client';

import { useActionState, useRef, useState, useTransition, type FormEvent } from 'react';
import type { IntakeState } from './actions.ts';
import { WizardActions, WizardProgress } from './wizard-ui.tsx';

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
  const [step, setStep] = useState(1);
  const formRef = useRef<HTMLFormElement>(null);

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
          <p className="muted small">Give your project a name and describe it in your own words.</p>
        </div>
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

      <section className="card stack wizard-panel" data-wizard-panel data-step="2">
        <div className="wizard-panel-heading">
          <span className="eyebrow">Step 2 · Features</span>
          <h2>What does it need?</h2>
          <p className="muted small">Choose everything that fits. Each one is built and checked separately.</p>
        </div>
        <div className="choice-list">
          {NEEDS.map((n) => (
            <label key={n.key} className="choice">
              <input type="checkbox" name={`need_${n.key}`} defaultChecked={n.key !== 'connect'} />
              <span>{n.text}<span className="hint">{n.hint}</span></span>
            </label>
          ))}
        </div>
      </section>

      <section className="card stack wizard-panel" data-wizard-panel data-step="3">
        <div className="wizard-panel-heading">
          <span className="eyebrow">Step 3 · Usage</span>
          <h2>How many people will use it?</h2>
          <p className="muted small">Choose the closest estimate. You can adjust your assumptions later.</p>
        </div>
        <div className="choice-list">
          {VISITORS.map((v) => (
            <label key={v.value} className="choice">
              <input type="radio" name="visitors" value={v.value} defaultChecked={v.value === '1000'} />
              <span>{v.text}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="card stack wizard-panel" data-wizard-panel data-step="4">
        <div className="wizard-panel-heading">
          <span className="eyebrow">Step 4 · Build</span>
          <h2>How should we build it?</h2>
          <p className="muted small">Choose a starting approach. You can change this later and see the price change.</p>
        </div>
        <div className="choice-list">
          {presets.map((p) => (
            <label key={p.id} className="choice">
              <input type="radio" name="preset" value={p.id} defaultChecked={p.id === 'budget'} />
              <span>{p.label}<span className="hint">{p.blurb}</span></span>
            </label>
          ))}
        </div>
      </section>

      {state.error && <p className="notice bad" role="alert">{state.error}</p>}
      <WizardActions step={step} onPrevious={() => setStep((current) => Math.max(1, current - 1))}
        onContinue={continueStep} pending={pending} submitLabel={pending ? 'Working out the price…' : 'Show me what it costs'} />
      <p className="muted small wizard-reassurance" style={{ margin: 0 }}>Nothing is built or charged until you say so.</p>
    </form>
  );
}
