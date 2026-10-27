import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getSessionUser } from '../src/server/session.ts';
import { signOutAction } from './auth-actions.ts';
import './globals.css';

export const metadata: Metadata = {
  title: 'MAKABL',
  description: 'See what an AI-built web app will cost before it is built, and cap the spend.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
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
