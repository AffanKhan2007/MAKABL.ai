import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DB_UNAVAILABLE_MESSAGE, isDbUnavailable } from '../src/server/db.ts';
import { getSessionUser } from '../src/server/session.ts';
import { signOutAction } from './auth-actions.ts';
import './globals.css';

export const metadata: Metadata = {
  title: 'MAKABL',
  description: 'See what an AI-built web app will cost before it is built, and cap the spend.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  let user: Awaited<ReturnType<typeof getSessionUser>> = null;
  let dbDown = false;
  try {
    user = await getSessionUser();
  } catch (err) {
    if (!isDbUnavailable(err)) throw err;
    dbDown = true;
  }
  if (dbDown) {
    return (
      <html lang="en">
        <body>
          <div className="shell">
            <header className="topbar"><span className="brand">MAKABL</span></header>
            <main style={{ maxWidth: 520, margin: '40px auto' }}>
              <h1>Can&rsquo;t reach the database</h1>
              <p className="notice bad">{DB_UNAVAILABLE_MESSAGE}</p>
            </main>
          </div>
        </body>
      </html>
    );
  }
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <Link href="/" className="brand">MAKABL</Link>
            {user && (
              <form action={signOutAction} className="row">
                <span className="muted small">{user.email}</span>
                <button type="submit" className="secondary">Sign out</button>
              </form>
            )}
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
