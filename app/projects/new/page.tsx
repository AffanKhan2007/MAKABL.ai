import { BUILD_MODELS } from '../../../src/server/plan.ts';
import { FEATURE_ROWS } from '../../format.ts';
import { IntakeForm } from './intake-form.tsx';

export default function NewProject() {
  return (
    <main>
      <h1>New project</h1>
      <p className="sub">Describe the app. You get a ranged cost plan before anything is built or spent.</p>
      <IntakeForm rows={FEATURE_ROWS} models={BUILD_MODELS} />
    </main>
  );
}
