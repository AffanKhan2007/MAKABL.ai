import { DEFAULT_ACCEPTANCE } from '../../../src/spec/acceptance.ts';
import { FEATURE_ROWS } from '../../../src/server/intake.ts';
import { getMode } from '../../../src/server/mode.ts';
import { PICKER_MODELS, PRESETS } from '../../../src/server/plan.ts';
import { requireUser } from '../../../src/server/session.ts';
import { createFromPromptAction, createProjectAction } from './actions.ts';
import { EasyIntake } from './easy-intake.tsx';
import { IntakeForm } from './intake-form.tsx';
import { PromptIntake } from './prompt-intake.tsx';

export const dynamic = 'force-dynamic';

export default async function NewProject() {
  await requireUser();
  const mode = await getMode();
  const presets = Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label, blurb: p.blurb }));
  return (
    <main className="new-project-page">
      <div className="new-project-heading">
        <span className="eyebrow">Project setup · {mode === 'easy' ? 'Easy mode' : 'Pro mode'}</span>
        <h1>New project</h1>
        <p className="sub">A few details now. A clear cost plan before anything is built.</p>
      </div>
      {mode === 'easy' ? (
        <>
          <PromptIntake action={createFromPromptAction} presets={presets} />
          <p className="muted small" style={{ margin: '18px 0 6px' }}>Or choose the features yourself:</p>
          <EasyIntake action={createProjectAction} presets={presets} />
        </>
      ) : (
        <>
          <IntakeForm action={createProjectAction} rows={FEATURE_ROWS} models={PICKER_MODELS}
            defaults={DEFAULT_ACCEPTANCE} submitLabel="Get the cost plan" presets={PRESETS} />
          <details className="pw-alt">
            <summary>Start from a single prompt instead</summary>
            <PromptIntake action={createFromPromptAction} presets={presets} />
          </details>
        </>
      )}
    </main>
  );
}
