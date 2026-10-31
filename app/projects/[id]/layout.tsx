import type { ReactNode } from 'react';
import { getMode } from '../../../src/server/mode.ts';
import { getProject } from '../../../src/server/projects.ts';
import { SideNav, type SideGroup } from './side-nav.tsx';

export default async function ProjectLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) return <>{children}</>;
  const easy = (await getMode()) === 'easy';
  const base = `/projects/${id}`;
  const groups: SideGroup[] = [
    {
      title: easy ? 'Your app' : 'Steps',
      items: [
        { label: 'Overview', href: base },
        { label: easy ? 'Tell it what you want' : 'Plan and steer', href: `${base}/steer` },
        { label: easy ? 'How it will look' : 'Wireframe and renders', href: `${base}/renders` },
        ...(easy ? [] : [{ label: 'Quality vs cost', href: `${base}/quality` }]),
        { label: 'Change the spec', href: `${base}/edit` },
      ],
    },
    {
      title: 'On the overview',
      items: [
        { label: easy ? 'Features' : 'Features', href: `${base}#features` },
        { label: easy ? 'What it costs' : 'Cost plan', href: `${base}#cost` },
        { label: easy ? 'Spending limit' : 'Budget', href: `${base}#budget` },
        { label: 'Build', href: `${base}#build` },
        { label: easy ? 'Your app' : 'Run the app', href: `${base}#app` },
        ...(easy ? [] : [{ label: 'Verification', href: `${base}#verification` }, { label: 'Ledger', href: `${base}#ledger` }]),
      ],
    },
  ];
  return (
    <div className="with-side">
      <SideNav name={project.name} groups={groups} />
      <div className="with-side-body">{children}</div>
    </div>
  );
}
