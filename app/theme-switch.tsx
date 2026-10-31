import type { Theme } from '../src/server/mode.ts';
import { setThemeAction } from './mode-actions.ts';

/** System, light or dark; remembered per browser in a cookie, rendered on the server. */
export function ThemeSwitch({ theme }: { theme: Theme | null }) {
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
