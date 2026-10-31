import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DB_UNAVAILABLE_MESSAGE, isDbUnavailable } from '../src/server/db.ts';
import { getSessionUser } from '../src/server/session.ts';
import { getMode, getTheme, type Theme } from '../src/server/mode.ts';
import { signOutAction } from './auth-actions.ts';
import { setModeAction, setThemeAction } from './mode-actions.ts';
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

/** System, light or dark; remembered per browser in a cookie. */
function ThemeSwitch({ theme }: { theme: Theme | null }) {
  const options = [
    { value: 'system', icon: '◐', label: 'Follow the system theme', on: theme === null },
    { value: 'light', icon: '☀', label: 'Light theme', on: theme === 'light' },
    { value: 'dark', icon: '☾', label: 'Dark theme', on: theme === 'dark' },
  ];
  return (
    <form action={setThemeAction} className="theme-switch" aria-label="Theme">
      {options.map((o) => (
        <button key={o.value} type="submit" name="theme" value={o.value} aria-pressed={o.on} aria-label={o.label} title={o.label}>
          {o.icon}
        </button>
      ))}
    </form>
  );
}

function Shell({ children, right, home, theme }: { children: ReactNode; right?: ReactNode; home: string; theme: Theme | null }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} {...(theme ? { 'data-theme': theme } : {})}>
      <body>
        <div className="shell">
          <header className="topbar">
            <Brand href={home} />
            <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <ThemeSwitch theme={theme} />
              {right}
            </div>
          </header>
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
      <Shell home="/" theme={theme}>
        <main className="auth">
          <h1>Can&rsquo;t reach the database</h1>
          <p className="notice bad">{DB_UNAVAILABLE_MESSAGE}</p>
        </main>
      </Shell>
    );
  }

  const mode = await getMode();
  const right = user ? (
    <div className="user">
      <form action={setModeAction} className="mode-switch" aria-label="Interface mode">
        <button type="submit" name="mode" value="easy" aria-pressed={mode === 'easy'} title="Plain words, fewer choices">Easy</button>
        <button type="submit" name="mode" value="pro" aria-pressed={mode === 'pro'} title="Every model, phase and number">Pro</button>
      </form>
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

  return <Shell home={user ? '/projects' : '/'} right={right} theme={theme}>{children}</Shell>;
}
