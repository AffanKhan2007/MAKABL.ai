import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { endSession, sessionUser, signIn, signUp } from '../src/auth/accounts.ts';
import { hashPassword, normalizeEmail, passwordProblem, verifyPassword } from '../src/auth/password.ts';
import { APP_ROLE, withTx } from '../src/db/scope.ts';
import { DATABASE_URL } from './support/envs.ts';

// Passwords below are throwaway test values for the local test database only.

test('passwords hash with a fresh salt and verify only the right password', async () => {
  const a = await hashPassword('correct horse battery');
  const b = await hashPassword('correct horse battery');
  assert.notEqual(a, b);
  assert.match(a, /^scrypt:17:8:1:/);
  assert.equal(await verifyPassword('correct horse battery', a), true);
  assert.equal(await verifyPassword('correct horse batterz', a), false);
  assert.equal(await verifyPassword('anything', 'not-a-hash'), false);
});

test('password and email rules', () => {
  assert.match(passwordProblem('short') ?? '', /at least 12/);
  assert.equal(passwordProblem('twelve chars'), null);
  assert.equal(normalizeEmail('  Me@Example.COM '), 'me@example.com');
  assert.equal(normalizeEmail('not an email'), null);
});

const pool = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000 });
const ready = await pool.query('select password_hash from users limit 1').then(() => true, () => false);
if (!ready) await pool.end();

describe('accounts and sessions', { skip: ready ? false : 'no test database (npm run db:reset:test)' }, () => {
  if (!ready) return;
  after(() => pool.end());
  const email = () => `user-${randomUUID()}@test.local`;
  const PW = 'test password one';

  test('sign up starts a session that identifies the user', async () => {
    const e = email();
    const r = await signUp(pool, e.toUpperCase(), PW);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.user.email, e);
    assert.deepEqual(await sessionUser(pool, r.token), r.user);
    // Only the token's hash is stored.
    const { rows } = await pool.query('select 1 from sessions where token_hash = $1', [r.token]);
    assert.equal(rows.length, 0);
  });

  test('a second sign-up with the same email is refused', async () => {
    const e = email();
    assert.ok((await signUp(pool, e, PW)).ok);
    const again = await signUp(pool, e, 'another password');
    assert.equal(again.ok, false);
  });

  test('sign-in fails the same way for a wrong password and an unknown email', async () => {
    const e = email();
    await signUp(pool, e, PW);
    const wrong = await signIn(pool, e, 'wrong password!!');
    const unknown = await signIn(pool, email(), PW);
    assert.deepEqual(wrong, unknown);
    assert.ok((await signIn(pool, e, PW)).ok);
  });

  test('repeated failures are throttled, even for the right password', async () => {
    const e = email();
    await signUp(pool, e, PW);
    for (let i = 0; i < 10; i++) await signIn(pool, e, `wrong guess ${i}`);
    const r = await signIn(pool, e, PW);
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.error, /Too many attempts/);
  });

  test('expired and ended sessions are rejected', async () => {
    const r = await signUp(pool, email(), PW);
    assert.ok(r.ok);
    if (!r.ok) return;
    await endSession(pool, r.token);
    assert.equal(await sessionUser(pool, r.token), null);

    const r2 = await signIn(pool, r.user.email, PW);
    assert.ok(r2.ok);
    if (!r2.ok) return;
    await pool.query(`update sessions set expires_at = now() - interval '1 second' where user_id = $1`, [r2.user.id]);
    assert.equal(await sessionUser(pool, r2.token), null);
    assert.equal(await sessionUser(pool, 'made-up-token'), null);
  });

  test('the app role cannot read password hashes or sessions', async () => {
    const r = await signUp(pool, email(), PW);
    assert.ok(r.ok);
    if (!r.ok) return;
    const asUser = { role: APP_ROLE, userId: r.user.id };
    await assert.rejects(withTx(pool, asUser, (c) => c.query('select password_hash from users')), /permission denied/);
    await assert.rejects(withTx(pool, asUser, (c) => c.query('select * from sessions')), /permission denied/);
    const own = await withTx(pool, asUser, (c) => c.query<{ email: string }>('select email from users'));
    assert.deepEqual(own.rows.map((x) => x.email), [r.user.email]);
  });
});
