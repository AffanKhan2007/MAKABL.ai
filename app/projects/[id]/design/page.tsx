import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PgEventLog } from '../../../../src/db/pg-event-log.ts';
import { designModel, designPrompt, DESIGN_SYSTEM, framedDocument, MAX_OUTPUT_TOKENS } from '../../../../src/design/render.ts';
import { worstCaseLlmCost } from '../../../../src/gate/llm-cost.ts';
import { gate } from '../../../../src/server/builds.ts';
import { db } from '../../../../src/server/db.ts';
import { rendersOf } from '../../../../src/server/design.ts';
import { getMode } from '../../../../src/server/mode.ts';
import { modelLabel, registry } from '../../../../src/server/plan.ts';
import { getProject } from '../../../../src/server/projects.ts';
import { userScope } from '../../../../src/server/session.ts';
import { money } from '../../../format.ts';
import { drawMockupAction } from './actions.ts';
import { DrawForm } from './draw-form.tsx';

// Design mockups: see what the app will look like before any code is written, and ask for
// another version until it is right. Each version shows the model that drew it, the tokens
// it used and what it cost from the cap.

export const dynamic = 'force-dynamic';

const fine = (micros: number) => (micros > 0 && micros < 10_000 ? `$${(micros / 1_000_000).toFixed(4)}` : money(micros));
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

export default async function DesignPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; v?: string }>;
}) {
  const { id } = await params;
  const { error, v } = await searchParams;
  const project = await getProject(id);
  if (!project) notFound();

  const easy = (await getMode()) === 'easy';
  const budget = await (await gate()).getBudget(id).catch(() => null);
  const renders = rendersOf(await new PgEventLog(db(), await userScope()).list(id));
  const shown = renders.find((r) => String(r.version) === v) ?? renders.at(-1) ?? null;
  const model = designModel(process.env);

  // What the next version could cost, from the registry: the prompt grows with the previous page.
  let estimate = '';
  if (model) {
    const price = registry.get(model);
    const promptChars = DESIGN_SYSTEM.length + designPrompt(project.spec).length + (renders.length ? Math.min(14_000, (shown ?? renders.at(-1)!).html.length) + 600 : 0);
    const worst = worstCaseLlmCost(price, Math.ceil(promptChars / 3), MAX_OUTPUT_TOKENS, 'none');
    const typical = worstCaseLlmCost(price, Math.ceil(promptChars / 4), Math.round(MAX_OUTPUT_TOKENS / 2), 'none');
    estimate = easy
      ? `About ${fine(typical)}, never more than ${fine(worst)}, taken from your limit. Nothing is charged until you press the button.`
      : `${modelLabel(model)} · about ${fine(typical)}, worst case ${fine(worst)} (${k(Math.ceil(promptChars / 3))} prompt + ${k(MAX_OUTPUT_TOKENS)} output tokens), reserved on the cap before the call.`;
  }
  const totalCost = renders.reduce((t, r) => t + r.cost, 0);
  const totalTokens = renders.reduce((t, r) => t + r.tokens.input + r.tokens.output, 0);

  return (
    <main>
      <p className="small" style={{ margin: '0 0 8px' }}><Link href={`/projects/${id}`}>← {project.name}</Link></p>
      <span className="eyebrow">{easy ? 'Before we build' : 'Design mockup'}</span>
      <h1>{easy ? 'See what your app will look like' : 'Wireframe the app before building it'}</h1>
      <p className="sub">
        {easy
          ? 'An AI sketches the main screens from your description. Not happy? Say what to change and get another version. The real app is built after you are happy with it.'
          : 'A low-fidelity mockup of the main screens, drawn from the spec by the cheapest model with a key. Each version is one call through the Budget Gate on the project cap; ask for changes as often as you like.'}
      </p>

      {error && <p className="notice bad">{error}</p>}

      {shown && (
        <section className="card stack design-view">
          <div className="row spread">
            <div className="row" style={{ gap: 6 }}>
              {renders.map((r) => (
                <Link key={r.version} href={`/projects/${id}/design?v=${r.version}`}
                  className={`badge${r.version === shown.version ? ' accent' : ''}`} aria-current={r.version === shown.version ? 'page' : undefined}>
                  v{r.version}
                </Link>
              ))}
            </div>
            <span className="muted small num">
              {renders.length} version{renders.length === 1 ? '' : 's'} · {k(totalTokens)} tokens · {fine(totalCost)} in all
            </span>
          </div>

          <div className="design-meta">
            <div><span className="kpi-label">Version</span><div className="num">v{shown.version}</div></div>
            <div><span className="kpi-label">{easy ? 'Drawn by' : 'Model'}</span><div className="num">{modelLabel(shown.model)}</div></div>
            <div><span className="kpi-label">Tokens in / out</span><div className="num">{k(shown.tokens.input)} / {k(shown.tokens.output)}</div></div>
            <div><span className="kpi-label">Cost</span><div className="num">{fine(shown.cost)}</div></div>
          </div>
          {shown.feedback && <p className="small" style={{ margin: 0 }}><span className="muted">{easy ? 'You asked:' : 'Change request:'}</span> {shown.feedback}</p>}

          {/* Untrusted model output: no scripts, no same-origin, no network (CSP in the document). */}
          <iframe className="design-frame" title={`Mockup version ${shown.version}`} sandbox="" referrerPolicy="no-referrer"
            srcDoc={framedDocument(shown.html)} />
          <p className="muted small" style={{ margin: 0 }}>
            A sketch of the layout and content, not the finished app. The build follows the spec; use this to agree what goes where.
          </p>
        </section>
      )}

      {/* Looking needs nothing; drawing needs an approved cap and a model key. */}
      <section className="card stack">
        <h2 style={{ margin: 0 }}>{shown ? (easy ? 'Not quite right?' : 'Ask for another version') : (easy ? 'Ready when you are' : 'First mockup')}</h2>
        {!budget ? (
          <>
            <p className="notice info" style={{ margin: 0 }}>
              {easy ? 'Set your spending limit on the project page first. A sketch costs a fraction of a cent and comes out of that limit.'
                : 'Approve the plan and set a cap first: mockups are paid from the project cap, like every other call.'}
            </p>
            <div><Link className="button secondary" href={`/projects/${id}`}>Back to the plan</Link></div>
          </>
        ) : !model ? (
          <p className="notice warn" style={{ margin: 0 }}>
            No model key on this server, so new versions cannot be drawn here. Add <code>DASHSCOPE_API_KEY</code>, <code>GEMINI_API_KEY</code>, <code>OPENAI_API_KEY</code> or <code>ANTHROPIC_API_KEY</code> to <code>.env.local</code> and restart.
          </p>
        ) : (
          <DrawForm action={drawMockupAction.bind(null, id)} first={!shown} easy={easy} estimate={estimate} {...(shown ? { base: shown.version } : {})} />
        )}
      </section>
    </main>
  );
}
