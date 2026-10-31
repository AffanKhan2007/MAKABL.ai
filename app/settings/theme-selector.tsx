'use client';

import { useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeOption {
  id: ThemePreference;
  label: string;
  description: string;
  badge?: string;
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'system',
    label: 'System Default',
    description: 'Automatically synchronizes with your device operating system preference.',
    badge: 'Adaptive',
  },
  {
    id: 'dark',
    label: 'Dark Mode',
    description: 'Deep graphite surfaces (#090D12) engineered for focused work and low eye strain.',
    badge: 'Default',
  },
  {
    id: 'light',
    label: 'Light Mode',
    description: 'Crisp, high-contrast surfaces (#F8FAFC) designed for bright daytime environments.',
  },
];

export function ThemeSelector() {
  const [currentTheme, setCurrentTheme] = useState<ThemePreference>('system');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem('makabl-theme') as ThemePreference | null;
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setCurrentTheme(stored);
      } else {
        setCurrentTheme('system');
      }
    } catch {
      setCurrentTheme('system');
    }
  }, []);

  const selectTheme = (theme: ThemePreference) => {
    setCurrentTheme(theme);
    try {
      localStorage.setItem('makabl-theme', theme);
      document.cookie = `makabl_theme=${theme}; path=/; max-age=31536000; SameSite=Lax`;

      if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
      } else if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
    } catch (err) {
      console.warn('Unable to persist theme preference:', err);
    }
  };

  return (
    <div className="theme-selector-grid" role="radiogroup" aria-label="Appearance color theme">
      {THEME_OPTIONS.map((opt) => {
        const isSelected = mounted && currentTheme === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            className={`theme-option-card ${isSelected ? 'active' : ''}`}
            onClick={() => selectTheme(opt.id)}
          >
            <div className="theme-option-header">
              <div className="row" style={{ gap: 8 }}>
                <span className={`theme-radio-dot ${isSelected ? 'selected' : ''}`} aria-hidden />
                <strong>{opt.label}</strong>
              </div>
              {opt.badge && <span className="badge accent">{opt.badge}</span>}
            </div>

            <p className="muted small" style={{ margin: '8px 0 12px', flex: 1 }}>
              {opt.description}
            </p>

            {/* Visual Miniature Preview */}
            <div className={`theme-card-miniature ${opt.id}`}>
              <div className="mini-header">
                <span className="mini-dot" />
                <span className="mini-bar" />
              </div>
              <div className="mini-body">
                <div className="mini-card">
                  <div className="mini-line" style={{ width: '60%' }} />
                  <div className="mini-line accent" style={{ width: '40%' }} />
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
