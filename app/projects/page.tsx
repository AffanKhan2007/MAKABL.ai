import Link from 'next/link';
import { listProjects } from '../../src/server/projects.ts';
import { getMode } from '../../src/server/mode.ts';
import { planFor } from '../../src/server/plan.ts';
import { requireUser } from '../../src/server/session.ts';
import { money, STATE_LABEL } from '../format.ts';

export const dynamic = 'force-dynamic';

export default async function Projects() {
  await requireUser();
  const [projects, mode] = await Promise.all([listProjects(), getMode()]);
  const plans = await Promise.all(projects.map((project) => planFor(project.spec)));

  return (
    <main className="projects-page">
      <header className="projects-heading">
        <div className="projects-heading-copy">
          <span className="eyebrow">Workspace</span>
          <h1>Projects</h1>
          <p className="sub">Plan your build, understand the cost, and keep every project moving.</p>
        </div>
        <Link href="/projects/new" className="button projects-create-button">
          <span aria-hidden>＋</span> New project
        </Link>
      </header>

      {projects.length === 0 ? (
        <section className="projects-empty card">
          <div className="projects-empty-visual" aria-hidden="true">
            <span className="projects-empty-orbit projects-empty-orbit-outer" />
            <span className="projects-empty-orbit projects-empty-orbit-inner" />
            <span className="projects-empty-spark">✳</span>
            <span className="projects-empty-center">✦</span>
          </div>
          <span className="eyebrow">A clearer way to build</span>
          <h2>Your next project starts with a plan.</h2>
          <p className="muted">Describe the app you have in mind. MAKABL will map the work and estimate the cost before anything is built.</p>
          <Link href="/projects/new" className="button projects-empty-button">Create your first project <span aria-hidden>→</span></Link>
        </section>
      ) : (
        <section className="projects-section" aria-labelledby="projects-list-heading">
          <div className="projects-list-heading">
            <div>
              <h2 id="projects-list-heading">Your projects</h2>
              <p className="muted small">Pick up where you left off.</p>
            </div>
            <span className="badge accent">{projects.length} {projects.length === 1 ? 'project' : 'projects'}</span>
          </div>
          <div className="project-grid">
            {projects.map((project, index) => {
              const status = STATE_LABEL[project.state] ?? { text: project.state, tone: '' };
              const paidPlan = plans[index]!.paths.find((path) => path.path === 'paid');
              return (
                <Link key={project.id} href={`/projects/${project.id}`} className="card project-card">
                  <div className="project-card-topline">
                    <span className={`badge ${status.tone}`}>{status.text}</span>
                    <span className="badge project-mode-badge">{mode === 'easy' ? 'Easy mode' : 'Pro mode'}</span>
                  </div>
                  <div className="project-card-content">
                    <h3>{project.name}</h3>
                    <p className="project-description">{project.spec.idea}</p>
                  </div>
                  <div className="project-card-details">
                    <div className="project-card-metric">
                      <span className="project-card-label">Expected cost</span>
                      <span className="project-cost num">{paidPlan ? money(paidPlan.totals.expected) : '—'}</span>
                    </div>
                    <div className="project-card-meta">
                      <span>{project.spec.features.length} feature{project.spec.features.length === 1 ? '' : 's'} <span aria-hidden>·</span> v{project.specVersion}</span>
                      <span>Created {new Date(project.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    </div>
                  </div>
                  <div className="project-card-action">
                    <span>Open project</span><span aria-hidden>↗</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
