import { DEFAULT_ACCEPTANCE } from '../../../src/spec/acceptance.ts';
import { FEATURE_ROWS } from '../../../src/server/intake.ts';
import { getMode } from '../../../src/server/mode.ts';
import { BUILD_MODELS, PRESETS } from '../../../src/server/plan.ts';
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
    <main style={{ maxWidth: 820 }}>
      <span className="eyebrow">Step 1 of 4 · Describe</span>
      <h1 style={{ marginTop: 10 }}>New project</h1>
      <PromptIntake action={createFromPromptAction} presets={presets} />
      <p className="muted small" style={{ margin: '18px 0 6px' }}>Or choose the features yourself:</p>
      {mode === 'easy' ? (
        <>
          <p className="sub">Tell us about your app in plain words. You see the price before anything is built.</p>
          <EasyIntake action={createProjectAction} presets={presets} />
        </>
      ) : (
        <>
          <p className="sub">Describe the app. You get a ranged cost plan before anything is built or spent.</p>
          <IntakeForm action={createProjectAction} rows={FEATURE_ROWS} models={BUILD_MODELS}
            defaults={DEFAULT_ACCEPTANCE} submitLabel="Get the cost plan" />
        </>
      )}
    </main>
  );
}
