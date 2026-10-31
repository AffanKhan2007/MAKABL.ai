import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DB_UNAVAILABLE_MESSAGE, isDbUnavailable } from '../src/server/db.ts';
import { getSessionUser } from '../src/server/session.ts';
import { getMode } from '../src/server/mode.ts';
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

const themeScript = `(function(){try{var t=localStorage.getItem('makabl-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}else{document.documentElement.removeAttribute('data-theme');}}catch(e){}})();`;

function Shell({ children, user, mode }: { children: ReactNode; user: Awaited<ReturnType<typeof getSessionUser>>; mode: 'easy' | 'pro' }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <div className="shell">
          <NavBar user={user} mode={mode} />
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
      <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        </head>
        <body>
          <div className="shell">
            <header className="topbar">
              <Brand href="/" />
            </header>
            <main className="auth">
              <h1>Can&rsquo;t reach the database</h1>
              <p className="notice bad">{DB_UNAVAILABLE_MESSAGE}</p>
            </main>
          </div>
        </body>
      </html>
    );
  }

  const mode = await getMode();
  return <Shell user={user} mode={mode}>{children}</Shell>;
}
