'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { MODE_COOKIE, THEME_COOKIE } from '../src/server/mode.ts';

export async function setModeAction(form: FormData): Promise<void> {
  const mode = form.get('mode') === 'pro' ? 'pro' : 'easy';
  (await cookies()).set(MODE_COOKIE, mode, { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  revalidatePath('/', 'layout');
}

export async function setThemeAction(form: FormData): Promise<void> {
  const theme = String(form.get('theme') ?? '');
  const jar = await cookies();
  if (theme === 'light' || theme === 'dark') {
    jar.set(THEME_COOKIE, theme, { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  } else {
    jar.delete(THEME_COOKIE);
  }
  revalidatePath('/', 'layout');
}
