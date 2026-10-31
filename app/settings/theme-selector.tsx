'use client';

import { useTransition } from 'react';
import { setThemeAction } from '../mode-actions.ts';

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

/**
 * The same choice as the switch in the top bar, with more room to explain it. The theme is a
 * cookie the server reads (see app/layout.tsx), so this just submits the shared action;
 * nothing is stored in the browser separately.
 */
export function ThemeSelector({ theme }: { theme: 'light' | 'dark' | null }) {
  const currentTheme: ThemePreference = theme ?? 'system';
  const mounted = true;
  const [, startTransition] = useTransition();
  const selectTheme = (next: ThemePreference) => {
    const form = new FormData();
    form.set('theme', next);
    startTransition(() => { void setThemeAction(form); });
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
