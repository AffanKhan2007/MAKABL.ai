import { redirect } from 'next/navigation';
import { getSessionUser } from '../../src/server/session.ts';
import { AuthForm } from '../auth-form.tsx';

export const dynamic = 'force-dynamic';

export default async function SignUpPage() {
  if (await getSessionUser()) redirect('/');
  return <AuthForm mode="signup" />;
}
