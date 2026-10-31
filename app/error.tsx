'use client';

// Shown when a page fails to render. In production Next.js hides the error's details,
// so this stays general; in development it adds the most common cause.

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const dev = process.env.NODE_ENV !== 'production';
  return (
    <main style={{ maxWidth: 560, margin: '40px auto' }} className="stack">
      <h1>Something went wrong</h1>
      <p className="muted">This page could not be loaded. Nothing was charged or changed by the failure itself.</p>
      {dev && (
        <p className="notice warn">
          In development this is usually the database not running: start it with <code>npm run db:local</code>.
          {error.message && <><br />Error: {error.message}</>}
        </p>
      )}
      {error.digest && <p className="muted small">Reference: {error.digest}</p>}
      <div><button type="button" onClick={() => reset()}>Try again</button></div>
    </main>
  );
}
