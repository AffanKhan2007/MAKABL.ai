import Link from 'next/link';
import { getSessionUser } from '../src/server/session.ts';

// Public landing page: the problem, the promise and the three-part answer, in one screen.
// The plan preview on the right is a labelled sample, not live data.

export const dynamic = 'force-dynamic';

const SAMPLE = [
  { label: 'Build: shop owner sign-in', range: '$0.40 – $4.82' },
  { label: 'Build: items API', range: '$0.18 – $2.10' },
  { label: 'Vercel Pro (hosting)', range: '$20.00' },
  { label: 'Supabase Pro (database)', range: '$25.00' },
];

export default async function Landing() {
  const user = await getSessionUser().catch(() => null);
  const start = user ? '/projects/new' : '/signup';

  return (
    <main>
      <section className="hero">
        <div>
          <span className="eyebrow">Cost-first AI app builder</span>
          <h1>Know what your AI-built app will cost. <span className="grad">Before it&rsquo;s built.</span></h1>
          <p className="lead">
            Describe a web app. MAKABL forecasts the build and the first months of running it as honest ranges,
            builds it under a hard spending cap, and pauses to ask before it ever goes over.
          </p>
          <div className="hero-actions">
            <Link href={start} className="button">{user ? 'Start a project' : 'Get started free'}</Link>
            {user
              ? <Link href="/projects" className="button secondary">Your projects</Link>
              : <Link href="#how" className="button secondary">How it works</Link>}
          </div>
        </div>

        <div className="mock" aria-label="Sample cost plan">
          <div className="card stack" style={{ marginBottom: 0 }}>
            <div className="row spread">
              <span className="mock-label">Sample plan · inventory tracker</span>
              <span className="badge good">Eligible</span>
            </div>
            <div>
              <div className="total">$47.86</div>
              <div className="muted small num">expected first month · range $45.95 – $56.42</div>
            </div>
            <div>
              {SAMPLE.map((l) => (
                <div className="mock-line" key={l.label}>
                  <span className="muted">{l.label}</span>
                  <span className="num">{l.range}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="row spread small"><span className="muted">Budget cap</span><span className="num">$0.66 of $1.00</span></div>
              <div className="bar"><span style={{ width: '66%' }} /></div>
            </div>
            <p className="notice warn small" style={{ margin: 0 }}>
              Paused: the next call could cost up to $0.37 and would cross the $1.00 cap. Approve to continue.
            </p>
          </div>
        </div>
      </section>

      <div className="section-title" id="how">
        <span className="eyebrow">How it works</span>
        <h2>Plan the spend, cap it, then prove the result</h2>
        <p className="muted" style={{ margin: 0 }}>AI build costs vary by an order of magnitude. MAKABL makes that visible and keeps it in bounds.</p>
      </div>

      <div className="grid3">
        <section className="card">
          <div className="feature-icon" aria-hidden>$</div>
          <h2>Plan</h2>
          <p className="muted" style={{ margin: 0 }}>
            A ranged forecast for every feature and service, free path against paid path, with verified prices, and
            the costs it cannot price listed instead of hidden.
          </p>
        </section>
        <section className="card">
          <div className="feature-icon" aria-hidden>⏸</div>
          <h2>Cap</h2>
          <p className="muted" style={{ margin: 0 }}>
            Every model call reserves its worst case before it runs. If it could cross your cap, the build pauses and
            asks. No surprise bills from the build.
          </p>
        </section>
        <section className="card">
          <div className="feature-icon" aria-hidden>✓</div>
          <h2>Prove</h2>
          <p className="muted" style={{ margin: 0 }}>
            Each feature is judged against acceptance criteria you approve. The report says what passed, who wrote the
            tests, and what was not checked.
          </p>
        </section>
      </div>

      <div className="steps" style={{ marginTop: 16 }}>
        <section className="card"><h3>Describe</h3><p className="muted small" style={{ margin: 0 }}>Your idea, its features and acceptance criteria.</p></section>
        <section className="card"><h3>Approve</h3><p className="muted small" style={{ margin: 0 }}>The plan, and the caps the build must stay under.</p></section>
        <section className="card"><h3>Build</h3><p className="muted small" style={{ margin: 0 }}>Watch it live. It pauses before any cap would be crossed.</p></section>
        <section className="card"><h3>Review</h3><p className="muted small" style={{ margin: 0 }}>Estimate against actual, and a verification report.</p></section>
      </div>

      <footer className="footer">
        <span>MAKABL · built for the hackathon on our own prototype (see the disclosure)</span>
        <span className="num">Next.js · Postgres · Claude</span>
      </footer>
    </main>
  );
}
