'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { SessionUser } from '../src/auth/accounts.ts';
import { signOutAction } from './auth-actions.ts';
import { setModeAction } from './mode-actions.ts';

interface NavBarProps {
  user: SessionUser | null;
  mode: 'easy' | 'pro';
}

function getInitials(email: string): string {
  const name = email.split('@')[0] ?? 'U';
  const parts = name.split(/[._-]/).filter(Boolean);
  const first = parts[0];
  const second = parts[1];
  if (first && second && first[0] && second[0]) {
    return (first[0] + second[0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function NavBar({ user, mode }: NavBarProps) {
  const pathname = usePathname();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isProjectsActive = pathname === '/projects' || (pathname.startsWith('/projects/') && pathname !== '/projects/new');
  const isNewProjectActive = pathname === '/projects/new';
  const isSettingsActive = pathname.startsWith('/settings');

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setDropdownOpen(false);
        setMobileMenuOpen(false);
      }
    }

    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [dropdownOpen]);

  // Close menus on route change
  useEffect(() => {
    setDropdownOpen(false);
    setMobileMenuOpen(false);
  }, [pathname]);

  const homeHref = user ? '/projects' : '/';

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Link href={homeHref} className="brand" aria-label="MAKABL home">
          <span className="brand-mark" aria-hidden>M</span>
          <span>MAKABL</span>
        </Link>

        {user && (
          <form action={setModeAction} className="mode-switch" aria-label="Interface mode">
            <button
              type="submit"
              name="mode"
              value="easy"
              aria-pressed={mode === 'easy'}
              title="Plain words, fewer choices"
            >
              Easy
            </button>
            <button
              type="submit"
              name="mode"
              value="pro"
              aria-pressed={mode === 'pro'}
              title="Every model, phase and number"
            >
              Pro
            </button>
          </form>
        )}
      </div>

      <div className="topbar-right">
        {user ? (
          <>
            <nav className="nav desktop-nav" aria-label="Main">
              <Link
                href="/projects"
                className={isProjectsActive ? 'active' : ''}
                aria-current={isProjectsActive ? 'page' : undefined}
              >
                Projects
              </Link>
              <Link
                href="/projects/new"
                className={isNewProjectActive ? 'active' : ''}
                aria-current={isNewProjectActive ? 'page' : undefined}
              >
                New Project
              </Link>
              <Link
                href="/settings"
                className={isSettingsActive ? 'active' : ''}
                aria-current={isSettingsActive ? 'page' : undefined}
              >
                Settings
              </Link>
            </nav>

            {/* Profile Dropdown */}
            <div className="profile-menu-container" ref={dropdownRef}>
              <button
                type="button"
                className="avatar-btn"
                onClick={() => setDropdownOpen((prev) => !prev)}
                aria-expanded={dropdownOpen}
                aria-haspopup="true"
                aria-label="User menu"
                title={user.email}
              >
                <span className="avatar-initials">{getInitials(user.email)}</span>
              </button>

              {dropdownOpen && (
                <div className="dropdown-menu" role="menu">
                  <div className="dropdown-header">
                    <div className="dropdown-user-email" title={user.email}>
                      {user.email}
                    </div>
                    <span className="badge good">Active</span>
                  </div>

                  <div className="dropdown-divider" />

                  <Link
                    href="/projects"
                    role="menuitem"
                    className={`dropdown-item ${isProjectsActive ? 'active' : ''}`}
                    onClick={() => setDropdownOpen(false)}
                  >
                    <span>Projects</span>
                  </Link>

                  <Link
                    href="/projects/new"
                    role="menuitem"
                    className={`dropdown-item ${isNewProjectActive ? 'active' : ''}`}
                    onClick={() => setDropdownOpen(false)}
                  >
                    <span>New Project</span>
                  </Link>

                  <Link
                    href="/settings"
                    role="menuitem"
                    className={`dropdown-item ${isSettingsActive ? 'active' : ''}`}
                    onClick={() => setDropdownOpen(false)}
                  >
                    <span>Settings</span>
                  </Link>

                  <div className="dropdown-divider" />

                  <form action={signOutAction} className="dropdown-form">
                    <button type="submit" role="menuitem" className="dropdown-item danger">
                      <span>Sign out</span>
                    </button>
                  </form>
                </div>
              )}
            </div>

            {/* Mobile menu toggle */}
            <button
              type="button"
              className="mobile-menu-toggle"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-expanded={mobileMenuOpen}
              aria-label="Toggle navigation menu"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {mobileMenuOpen ? (
                  <>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </>
                ) : (
                  <>
                    <line x1="4" y1="8" x2="20" y2="8" />
                    <line x1="4" y1="16" x2="20" y2="16" />
                  </>
                )}
              </svg>
            </button>
          </>
        ) : (
          <nav className="nav" aria-label="Account">
            <Link href="/login">Sign in</Link>
            <Link href="/signup" className="button small">Get started</Link>
          </nav>
        )}
      </div>

      {/* Mobile navigation drawer / dropdown */}
      {user && mobileMenuOpen && (
        <div className="mobile-nav-panel">
          <nav className="mobile-nav-links" aria-label="Mobile Main">
            <Link
              href="/projects"
              className={isProjectsActive ? 'active' : ''}
              onClick={() => setMobileMenuOpen(false)}
            >
              Projects
            </Link>
            <Link
              href="/projects/new"
              className={isNewProjectActive ? 'active' : ''}
              onClick={() => setMobileMenuOpen(false)}
            >
              New Project
            </Link>
            <Link
              href="/settings"
              className={isSettingsActive ? 'active' : ''}
              onClick={() => setMobileMenuOpen(false)}
            >
              Settings
            </Link>
          </nav>
          <div className="mobile-nav-footer">
            <span className="muted small">{user.email}</span>
            <form action={signOutAction}>
              <button type="submit" className="button secondary small">Sign out</button>
            </form>
          </div>
        </div>
      )}
    </header>
  );
}
