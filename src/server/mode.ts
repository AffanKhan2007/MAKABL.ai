import { cookies } from 'next/headers';

// Easy mode speaks plainly and asks little; Pro mode shows every model, phase and number.
// The choice is a per-browser preference, not part of the account.

export type UiMode = 'easy' | 'pro';
export const MODE_COOKIE = 'makabl_mode';

export async function getMode(): Promise<UiMode> {
  return (await cookies()).get(MODE_COOKIE)?.value === 'pro' ? 'pro' : 'easy';
}

/** Light or dark, or null to follow the visitor's system setting. Also per browser. */
export type Theme = 'light' | 'dark';
export const THEME_COOKIE = 'makabl_theme';

export async function getTheme(): Promise<Theme | null> {
  const v = (await cookies()).get(THEME_COOKIE)?.value;
  return v === 'light' || v === 'dark' ? v : null;
}
