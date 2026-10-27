'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { signInAction, signUpAction, type AuthFormState } from './auth-actions.ts';

export function AuthForm({ mode }: { mode: 'signin' | 'signup' }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    mode === 'signin' ? signInAction : signUpAction, { error: null, email: '' });
  const signup = mode === 'signup';

  return (
    <main style={{ maxWidth: 420, margin: '40px auto' }}>
      <h1>{signup ? 'Create your account' : 'Sign in'}</h1>
      <p className="sub">{signup ? 'See what an AI-built app will cost before it is built.' : 'Welcome back.'}</p>
      <form action={action} className="card stack">
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required maxLength={254}
            defaultValue={state.email} key={state.email} />
        </div>
        <div>
          <label htmlFor="password">
            Password {signup && <span className="hint">at least 12 characters</span>}
          </label>
          <input id="password" name="password" type="password" required
            autoComplete={signup ? 'new-password' : 'current-password'}
            minLength={signup ? 12 : 1} maxLength={256} />
        </div>
        {state.error && <p className="notice bad" role="alert" style={{ margin: 0 }}>{state.error}</p>}
        <button type="submit" disabled={pending}>
          {pending ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <p className="muted small">
        {signup
          ? <>Already have an account? <Link href="/login">Sign in</Link></>
          : <>New here? <Link href="/signup">Create an account</Link></>}
      </p>
    </main>
  );
}
