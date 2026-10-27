import Link from 'next/link';
import { listProjects } from '../src/server/projects.ts';
import { STATE_LABEL } from './format.ts';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const projects = await listProjects();
  return (
    <main>
      <div className="row spread" style={{ marginBottom: 20 }}>
        <div>
          <h1>Projects</h1>
          <p className="sub" style={{ margin: 0 }}>See the cost before the build, then cap it.</p>
        </div>
        <Link href="/projects/new" className="button">New project</Link>
      </div>

      <section className="card">
        {projects.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No projects yet. <Link href="/projects/new">Describe an app</Link> to get a cost plan.
          </p>
        ) : (
          <ul className="project-list">
            {projects.map((p) => {
              const s = STATE_LABEL[p.state] ?? { text: p.state, tone: '' };
              return (
                <li key={p.id}>
                  <div>
                    <Link href={`/projects/${p.id}`}>{p.name}</Link>
                    <div className="muted small">
                      {p.spec.features.length} feature{p.spec.features.length === 1 ? '' : 's'} ·{' '}
                      created {new Date(p.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                  <div className="row">
                    {p.buildMode === 'simulated' && <span className="badge">Simulated</span>}
                    <span className={`badge ${s.tone}`}>{s.text}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
