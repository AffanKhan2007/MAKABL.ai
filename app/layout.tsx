import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DB_UNAVAILABLE_MESSAGE, isDbUnavailable } from '../src/server/db.ts';
import { getSessionUser } from '../src/server/session.ts';
import { getMode, getTheme, type Theme } from '../src/server/mode.ts';
import { NavBar } from './nav-bar.tsx';
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
      <span>MAKABL</span>
    </Link>
  );
}

// The theme is a cookie read here on the server, so the page renders in the right theme
// from the first byte (no flash). The nav bar and the settings page both set that cookie.
function Shell({ children, theme, nav }: { children: ReactNode; theme: Theme | null; nav: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} {...(theme ? { 'data-theme': theme } : {})}>
      <body>
        <div className="shell">
          {nav}
          {children}
        </div>
      </body>
    </html>
  );
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = await getTheme();
  let user: Awaited<ReturnType<typeof getSessionUser>> = null;
  try {
    user = await getSessionUser();
  } catch (err) {
    if (!isDbUnavailable(err)) throw err;
    return (
      <Shell theme={theme} nav={<header className="topbar"><Brand href="/" /></header>}>
        <main className="auth">
          <h1>Can&rsquo;t reach the database</h1>
          <p className="notice bad">{DB_UNAVAILABLE_MESSAGE}</p>
        </main>
      </Shell>
    );
  }

  const mode = await getMode();
  return <Shell theme={theme} nav={<NavBar user={user} mode={mode} theme={theme} />}>{children}</Shell>;
}
