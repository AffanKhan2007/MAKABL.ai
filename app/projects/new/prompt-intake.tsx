'use client';

import { useActionState } from 'react';
import type { IntakeState } from './actions.ts';

// One prompt in: a model splits it into features through the Budget Gate, then the usual
// cost plan, caps and build follow. The split is shown, and editable, on the project page.

interface Preset { id: string; label: string; blurb: string }

export function PromptIntake({ action, presets }: {
  action: (prev: IntakeState, form: FormData) => Promise<IntakeState>;
  presets: Preset[];
}) {
  const [state, formAction, pending] = useActionState<IntakeState, FormData>(action, { error: null });
  return (
    <form action={formAction} className="card stack">
      <h2 style={{ margin: 0 }}>Describe it in one prompt</h2>
      <p className="muted small" style={{ margin: 0 }}>
        An AI model splits your prompt into features, through the same spending cap as the build (one small call,
        usually under a cent). You see the features and the price before anything is built.
      </p>
      <div>
        <label htmlFor="p-name">What is your app called?</label>
        <input id="p-name" name="name" type="text" maxLength={80} required placeholder="Table bookings" />
      </div>
      <div>
        <label htmlFor="p-idea">What should it do?</label>
        <textarea id="p-idea" name="idea" rows={3} minLength={10} maxLength={2000} required
          placeholder="Customers book a table at my restaurant online. My staff sign in to see today's bookings and change or cancel them." />
      </div>
      <label className="check"><input type="checkbox" name="commercial" defaultChecked /> This is for my business</label>
      <div>
        <label htmlFor="p-preset">How should we build it?</label>
        <select id="p-preset" name="preset" defaultValue="balanced">
          {presets.map((p) => <option key={p.id} value={p.id}>{p.label}: {p.blurb}</option>)}
        </select>
      </div>
      {state.error && <p className="notice bad" role="alert" style={{ margin: 0 }}>{state.error}</p>}
      <div>
        <button type="submit" disabled={pending}>{pending ? 'Splitting your prompt…' : 'Split it and show the cost'}</button>
      </div>
    </form>
  );
}
