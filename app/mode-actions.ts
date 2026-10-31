'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { MODE_COOKIE } from '../src/server/mode.ts';

export async function setModeAction(form: FormData): Promise<void> {
  const mode = form.get('mode') === 'pro' ? 'pro' : 'easy';
  (await cookies()).set(MODE_COOKIE, mode, { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  revalidatePath('/', 'layout');
}
