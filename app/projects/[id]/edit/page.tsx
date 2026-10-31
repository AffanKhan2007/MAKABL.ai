import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DEFAULT_ACCEPTANCE } from '../../../../src/spec/acceptance.ts';
import { isRunning } from '../../../../src/server/builds.ts';
import { FEATURE_ROWS } from '../../../../src/server/intake.ts';
import { BUILD_MODELS, PRESETS } from '../../../../src/server/plan.ts';
import { getProject } from '../../../../src/server/projects.ts';
import { IntakeForm } from '../../new/intake-form.tsx';
import { updateSpecAction } from './actions.ts';

export const dynamic = 'force-dynamic';

export default async function EditProject({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();
  const built = project.state !== 'costed' && project.state !== 'approved';

  return (
    <main>
      <p className="small" style={{ margin: '0 0 8px' }}><Link href={`/projects/${id}`}>← {project.name}</Link></p>
      <h1>Change the spec</h1>
      <p className="sub">
        Saving creates version {project.specVersion + 1} of the spec and sends the cost plan back for your approval.
        {built && ' Features already built and left unchanged are not built again.'}
      </p>
      {isRunning(id) ? (
        <p className="notice warn">The build is running. Wait for it to pause or finish before changing the spec.</p>
      ) : (
        <IntakeForm action={updateSpecAction.bind(null, id)} rows={FEATURE_ROWS} models={BUILD_MODELS}
          defaults={DEFAULT_ACCEPTANCE} initial={{ name: project.name, spec: project.spec }} submitLabel="Save and re-plan" presets={PRESETS} />
      )}
    </main>
  );
}
