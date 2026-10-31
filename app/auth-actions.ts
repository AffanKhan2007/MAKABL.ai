'use server';

import { redirect } from 'next/navigation';
import { signIn, signUp, type AuthResult } from '../src/auth/accounts.ts';
import { db, DB_UNAVAILABLE_MESSAGE, isDbUnavailable } from '../src/server/db.ts';
import { signOutCurrent, startSession } from '../src/server/session.ts';

export interface AuthFormState {
  error: string | null;
  /** Echoed back so the email survives React resetting the form after the action. */
  email: string;
}

const field = (form: FormData, key: string) => String(form.get(key) ?? '');

/** Runs an auth call, turning "database unreachable" into a message instead of a crash. */
async function attempt(email: string, call: () => Promise<AuthResult>): Promise<AuthResult | AuthFormState> {
  try {
    return await call();
  } catch (err) {
    if (isDbUnavailable(err)) return { error: DB_UNAVAILABLE_MESSAGE, email };
    throw err;
  }
}

export async function signUpAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = field(form, 'email').slice(0, 254);
  const result = await attempt(email, () => signUp(db(), email, field(form, 'password')));
  if (!('ok' in result)) return result;
  if (!result.ok) return { error: result.error, email };
  await startSession(result);
  redirect('/projects');
}

export async function signInAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = field(form, 'email').slice(0, 254);
  const result = await attempt(email, () => signIn(db(), email, field(form, 'password')));
  if (!('ok' in result)) return result;
  if (!result.ok) return { error: result.error, email };
  await startSession(result);
  redirect('/projects');
}

export async function signOutAction(): Promise<void> {
  await signOutCurrent();
  redirect('/login');
}
