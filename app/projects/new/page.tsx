import { DEFAULT_ACCEPTANCE } from '../../../src/spec/acceptance.ts';
import { FEATURE_ROWS } from '../../../src/server/intake.ts';
import { BUILD_MODELS } from '../../../src/server/plan.ts';
import { requireUser } from '../../../src/server/session.ts';
import { createProjectAction } from './actions.ts';
import { IntakeForm } from './intake-form.tsx';

export const dynamic = 'force-dynamic';

export default async function NewProject() {
  await requireUser();
  return (
    <main style={{ maxWidth: 820 }}>
      <span className="eyebrow">Step 1 of 4 · Describe</span>
      <h1 style={{ marginTop: 10 }}>New project</h1>
      <p className="sub">Describe the app. You get a ranged cost plan before anything is built or spent.</p>
      <IntakeForm action={createProjectAction} rows={FEATURE_ROWS} models={BUILD_MODELS}
        defaults={DEFAULT_ACCEPTANCE} submitLabel="Get the cost plan" />
    </main>
  );
}
