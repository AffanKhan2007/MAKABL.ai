'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { renderDocument } from '../../../../src/relay/render.ts';
import { money } from '../../../format.ts';
import type { RenderRecord } from '../../../../src/server/renders.ts';
import type { RenderState } from './actions.ts';

// The render studio: the latest mockup in a device frame, every earlier version one click
// away, and a box to say what to change. The mockup is model-written HTML, so it is cleaned
// on the server, cleaned again here, and shown in an iframe that has no permissions at all
// (no sandbox flags: no scripts, no forms, no navigation, no same-origin access).

interface Props {
  projectId: string;
  renders: RenderRecord[];
  action: (prev: RenderState, form: FormData) => Promise<RenderState>;
  pages: string[];
  easy: boolean;
  labels: Record<string, string>;
}

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
const fine = (micros: number) => (micros > 0 && micros < 10_000 ? `$${(micros / 1_000_000).toFixed(4)}` : money(micros));

export function RenderStudio({ renders, action, pages, easy, labels }: Props) {
  const [state, formAction, pending] = useActionState<RenderState, FormData>(action, { error: null, done: null });
  const [, startTransition] = useTransition();
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop');
  const [picked, setPicked] = useState<number | null>(null);
  const [page, setPage] = useState(pages[0] ?? 'Home');
  const [feedback, setFeedback] = useState('');

  const current = renders.find((r) => r.n === picked) ?? renders[renders.length - 1];
  // A new render arrives: show it, and clear the box that asked for it.
  useEffect(() => {
    if (state.done !== null) { setPicked(state.done); setFeedback(''); }
  }, [state.done]);

  const submit = (asChange: boolean) => {
    const data = new FormData();
    data.set('page', asChange && current ? current.page : page);
    data.set('feedback', asChange ? feedback : '');
    startTransition(() => formAction(data));
  };

  return (
    <section className="card stack render-studio" aria-busy={pending}>
      <div className="row spread">
        <div className="seg" role="tablist" aria-label="Device">
          <button type="button" role="tab" aria-selected={device === 'desktop'} onClick={() => setDevice('desktop')}>Desktop</button>
          <button type="button" role="tab" aria-selected={device === 'phone'} onClick={() => setDevice('phone')}>Phone</button>
        </div>
        {current && <span className="muted small num">v{current.n} · {current.page}</span>}
      </div>

      <div className={`render-stage ${device}${pending ? ' drawing' : ''}`}>
        {current ? (
          <div className="render-frame" key={current.n}>
            <iframe title={`Render ${current.n}: ${current.page}`} srcDoc={renderDocument(current.html)} sandbox="" loading="lazy" />
          </div>
        ) : (
          <div className="render-empty">
            <p style={{ margin: 0 }}>{pending ? 'Drawing your first page…' : 'No render yet.'}</p>
            {!pending && <p className="muted small" style={{ margin: 0 }}>
              {easy ? 'Pick a page and the AI draws how it could look.' : 'Pick a page and draw it from the description and features.'}
            </p>}
          </div>
        )}
        {pending && <div className="render-scan" aria-hidden />}
      </div>

      {current && (
        <div className="render-meta small muted num">
          {easy
            ? <span>Drawn by {labels[current.model] ?? current.model}.</span>
            : <span>{labels[current.model] ?? current.model} · {k(current.tokens.input)} in / {k(current.tokens.output)} out · {fine(current.cost)}</span>}
          {current.feedback && <span className="render-asked">You asked: “{current.feedback}”</span>}
        </div>
      )}

      {renders.length > 1 && (
        <div className="render-versions" role="tablist" aria-label="Versions">
          {renders.map((r) => (
            <button key={r.n} type="button" role="tab" aria-selected={current?.n === r.n} className="version" onClick={() => setPicked(r.n)}>
              <strong>v{r.n}</strong><small>{r.page}</small>
            </button>
          ))}
        </div>
      )}

      <div className="render-ask">
        {current ? (
          <>
            <label htmlFor="render-feedback">{easy ? 'Not quite right? Say what to change.' : 'What should change?'}</label>
            <textarea id="render-feedback" rows={2} maxLength={500} value={feedback} onChange={(e) => setFeedback(e.target.value)}
              placeholder="For example: warmer colours, bigger prices, put the menu first" disabled={pending} />
            <div className="row">
              <button type="button" onClick={() => submit(true)} disabled={pending || !feedback.trim()}>
                {pending ? 'Drawing…' : 'Draw it again'}
              </button>
              <span className="muted small">or draw another page:</span>
              <select value={page} onChange={(e) => setPage(e.target.value)} aria-label="Page to draw" disabled={pending}>
                {[...new Set(['Home', ...pages])].map((p) => <option key={p}>{p}</option>)}
              </select>
              <button type="button" className="secondary" onClick={() => submit(false)} disabled={pending}>Draw this page</button>
            </div>
          </>
        ) : (
          <div className="row">
            <select value={page} onChange={(e) => setPage(e.target.value)} aria-label="Page to draw" disabled={pending}>
              {[...new Set(['Home', ...pages])].map((p) => <option key={p}>{p}</option>)}
            </select>
            <button type="button" onClick={() => submit(false)} disabled={pending}>{pending ? 'Drawing…' : 'Draw a render'}</button>
          </div>
        )}
        <p className="hint" style={{ margin: 0 }}>
          Each render is a model call counted against your spending limit, normally a fraction of a cent on a small model.
        </p>
        {state.error && <p className="notice bad" role="alert" style={{ margin: 0 }}>{state.error}</p>}
      </div>
    </section>
  );
}
