'use server';

import { redirect } from 'next/navigation';
import { signIn, signUp } from '../src/auth/accounts.ts';
import { db } from '../src/server/db.ts';
import { signOutCurrent, startSession } from '../src/server/session.ts';

export interface AuthFormState {
  error: string | null;
  /** Echoed back so the email survives React resetting the form after the action. */
  email: string;
}

const field = (form: FormData, key: string) => String(form.get(key) ?? '');

export async function signUpAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = field(form, 'email').slice(0, 254);
  const result = await signUp(db(), email, field(form, 'password'));
  if (!result.ok) return { error: result.error, email };
  await startSession(result);
  redirect('/');
}

export async function signInAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = field(form, 'email').slice(0, 254);
  const result = await signIn(db(), email, field(form, 'password'));
  if (!result.ok) return { error: result.error, email };
  await startSession(result);
  redirect('/');
}

export async function signOutAction(): Promise<void> {
  await signOutCurrent();
  redirect('/login');
}
