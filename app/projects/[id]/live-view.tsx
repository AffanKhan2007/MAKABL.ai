'use client';

import { useEffect, useState } from 'react';

// Live view: the app the models are writing, embedded while the build runs. The dev server
// hot-reloads as files are written, so there is nothing to refresh. It lives only as long
// as the build; afterwards "Your app" opens the finished production build.

interface View { status: string; url: string | null; log: string }

export function LiveView({ projectId, building, easy }: { projectId: string; building: boolean; easy: boolean }) {
  const [view, setView] = useState<View | null>(null);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/live-preview`, { cache: 'no-store' });
        if (res.ok && !stopped) setView(await res.json() as View);
      } catch { /* the next poll will try again */ }
    };
    void poll();
    // Poll while the build runs, and once more shortly after it ends to show the last state.
    const timer = setInterval(poll, building ? 2_000 : 10_000);
    return () => { stopped = true; clearInterval(timer); };
  }, [projectId, building]);

  const running = view?.status === 'running' && view.url;
  if (!building && !running) return null;

  return (
    <section className="card stack live-view">
      <div className="row spread">
        <div>
          <span className="eyebrow">{easy ? 'Watch it being built' : 'Live view · dev server'}</span>
          <h2 style={{ margin: '4px 0 0' }}>{easy ? 'Your app, as the AI writes it' : 'The app as the builder writes it'}</h2>
        </div>
        {running
          ? <span className="badge good">live</span>
          : <span className={`badge ${view?.status === 'failed' ? 'bad' : 'warn'}`}>{view?.status === 'failed' ? 'unavailable' : 'starting…'}</span>}
      </div>
      {running ? (
        <>
          <div className="live-frame">
            <iframe src={view.url!} title="The app being built" loading="lazy" />
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            {easy
              ? 'Early on it may show an error or a blank page: the AI is still writing it. The page updates by itself.'
              : 'Generated code running on this computer without a sandbox. A half-written page may show an error; hot reload updates it as files change.'}
            {' '}<a href={view.url!} target="_blank" rel="noreferrer">Open in a new tab ↗</a>
          </p>
        </>
      ) : view?.status === 'failed' ? (
        <p className="muted small" style={{ margin: 0 }}>
          The live view could not start{easy ? '' : ` (${view.log.split('\n').filter(Boolean).slice(-1)[0] ?? 'no details'})`}. The build itself is not affected.
        </p>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>Starting the live view once the project&rsquo;s tools are installed. This takes a minute or two.</p>
      )}
    </section>
  );
}
