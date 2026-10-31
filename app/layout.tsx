import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DB_UNAVAILABLE_MESSAGE, isDbUnavailable } from '../src/server/db.ts';
import { getSessionUser } from '../src/server/session.ts';
import { signOutAction } from './auth-actions.ts';
import './globals.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: 'MAKABL: know what your AI-built app costs before it is built',
  description: 'A ranged cost plan before the build, a hard cap during it, and proof of what was checked after.',
};

export function Brand({ href }: { href: string }) {
  return (
    <Link href={href} className="brand" aria-label="MAKABL home">
      <span className="brand-mark" aria-hidden>M</span>
      MAKABL
    </Link>
  );
}

function Shell({ children, right, home }: { children: ReactNode; right?: ReactNode; home: string }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <div className="shell">
          <header className="topbar">
            <Brand href={home} />
            {right}
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  let user: Awaited<ReturnType<typeof getSessionUser>> = null;
  try {
    user = await getSessionUser();
  } catch (err) {
    if (!isDbUnavailable(err)) throw err;
    return (
      <Shell home="/">
        <main className="auth">
          <h1>Can&rsquo;t reach the database</h1>
          <p className="notice bad">{DB_UNAVAILABLE_MESSAGE}</p>
        </main>
      </Shell>
    );
  }

  const right = user ? (
    <div className="user">
      <nav className="nav" aria-label="Main">
        <Link href="/projects">Projects</Link>
        <Link href="/projects/new">New project</Link>
      </nav>
      <form action={signOutAction} className="row">
        <span className="muted small email">{user.email}</span>
        <button type="submit" className="secondary small">Sign out</button>
      </form>
    </div>
  ) : (
    <nav className="nav" aria-label="Account">
      <Link href="/login">Sign in</Link>
      <Link href="/signup" className="button small">Get started</Link>
    </nav>
  );

  return <Shell home={user ? '/projects' : '/'} right={right}>{children}</Shell>;
}
