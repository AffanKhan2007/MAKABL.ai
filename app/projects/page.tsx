import Link from 'next/link';
import { listProjects } from '../../src/server/projects.ts';
import { requireUser } from '../../src/server/session.ts';
import { STATE_LABEL } from '../format.ts';

export const dynamic = 'force-dynamic';

export default async function Projects() {
  await requireUser();
  const projects = await listProjects();
  return (
    <main>
      <div className="row spread" style={{ marginBottom: 22 }}>
        <div>
          <span className="eyebrow">Workspace</span>
          <h1 style={{ marginTop: 8 }}>Projects</h1>
          <p className="sub" style={{ margin: 0 }}>See the cost before the build, then cap it.</p>
        </div>
        <Link href="/projects/new" className="button">New project</Link>
      </div>

      {projects.length === 0 ? (
        <section className="card" style={{ textAlign: 'center', padding: '44px 20px' }}>
          <h2>No projects yet</h2>
          <p className="muted">Describe an app and get a ranged cost plan in under a minute.</p>
          <Link href="/projects/new" className="button">Describe an app</Link>
        </section>
      ) : (
        <div className="project-grid">
          {projects.map((p) => {
            const s = STATE_LABEL[p.state] ?? { text: p.state, tone: '' };
            return (
              <Link key={p.id} href={`/projects/${p.id}`} className="card project-card">
                <div className="row spread" style={{ marginBottom: 10 }}>
                  <span className={`badge ${s.tone}`}>{s.text}</span>
                  <span className={`badge ${p.buildMode === 'live' ? 'warn' : ''}`}>{p.buildMode}</span>
                </div>
                <h2>{p.name}</h2>
                <p className="muted small" style={{ margin: '0 0 12px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {p.spec.idea}
                </p>
                <div className="row spread small muted num">
                  <span>{p.spec.features.length} feature{p.spec.features.length === 1 ? '' : 's'} · v{p.specVersion}</span>
                  <span>{new Date(p.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
