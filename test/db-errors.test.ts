import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { isDbUnavailable } from '../src/server/db.ts';

const coded = (code: string) => Object.assign(new Error(''), { code });

test('a refused connection is recognised, including Node\'s per-address AggregateError', () => {
  assert.equal(isDbUnavailable(coded('ECONNREFUSED')), true);
  assert.equal(isDbUnavailable(new AggregateError([coded('ECONNREFUSED'), coded('ECONNREFUSED')])), true);
  assert.equal(isDbUnavailable(coded('57P03')), true);
});

test('query errors are not mistaken for an unreachable database', () => {
  assert.equal(isDbUnavailable(coded('42P01')), false);              // undefined table
  assert.equal(isDbUnavailable(new Error('boom')), false);
  assert.equal(isDbUnavailable(new AggregateError([coded('ECONNREFUSED'), new Error('x')])), false);
  assert.equal(isDbUnavailable(null), false);
});

test('a real connection to a closed port is recognised', async () => {
  // Port 1 on localhost: nothing listens there.
  const pool = new pg.Pool({ connectionString: 'postgres://u:p@localhost:1/x', connectionTimeoutMillis: 2000 });
  try {
    await assert.rejects(pool.query('select 1'), (err) => isDbUnavailable(err));
  } finally {
    await pool.end();
  }
});
