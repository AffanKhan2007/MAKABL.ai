import { DEFAULT_ACCEPTANCE } from '../../../src/spec/acceptance.ts';
import { FEATURE_ROWS } from '../../../src/server/intake.ts';
import { getMode } from '../../../src/server/mode.ts';
import { BUILD_MODELS, PRESETS } from '../../../src/server/plan.ts';
import { requireUser } from '../../../src/server/session.ts';
import { createProjectAction } from './actions.ts';
import { EasyIntake } from './easy-intake.tsx';
import { IntakeForm } from './intake-form.tsx';

export const dynamic = 'force-dynamic';

export default async function NewProject() {
  await requireUser();
  const mode = await getMode();
  return (
    <main className="new-project-page">
      <div className="new-project-heading">
        <span className="eyebrow">Project setup · {mode === 'easy' ? 'Easy mode' : 'Pro mode'}</span>
        <h1>New project</h1>
        <p className="sub">A few details now. A clear cost plan before anything is built.</p>
      </div>
      {mode === 'easy' ? (
        <EasyIntake action={createProjectAction}
          presets={Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label, blurb: p.blurb }))} />
      ) : (
        <IntakeForm action={createProjectAction} rows={FEATURE_ROWS} models={BUILD_MODELS}
          defaults={DEFAULT_ACCEPTANCE} submitLabel="Get the cost plan" />
      )}
    </main>
  );
}
