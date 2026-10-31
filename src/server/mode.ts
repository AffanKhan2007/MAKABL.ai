import { cookies } from 'next/headers';

// Easy mode speaks plainly and asks little; Pro mode shows every model, phase and number.
// The choice is a per-browser preference, not part of the account.

export type UiMode = 'easy' | 'pro';
export const MODE_COOKIE = 'makabl_mode';

export async function getMode(): Promise<UiMode> {
  return (await cookies()).get(MODE_COOKIE)?.value === 'pro' ? 'pro' : 'easy';
}
