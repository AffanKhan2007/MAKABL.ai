import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'MAKABL',
  description: 'See what an AI-built web app will cost before it is built, and cap the spend.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <Link href="/" className="brand">MAKABL</Link>
            <span className="badge warn">Development build</span>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
