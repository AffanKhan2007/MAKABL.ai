import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ACCEPTANCE } from '../src/spec/acceptance.ts';
import { MAX_SPLIT_FEATURES, parseSplit, ruleSplit } from '../src/spec/split.ts';

test('a model split is read from JSON, even with prose around it', () => {
  const reply = 'Here you go:\n```json\n' + JSON.stringify({
    features: [
      { name: 'Staff sign-in', type: 'auth', acceptance: ['Staff can sign in and out.'] },
      { name: 'Booking form', type: 'form_page', acceptance: ['A customer picks a date, time and party size.', 'Past dates are rejected.'] },
      { name: "Today's bookings", type: 'page', acceptance: [] },
    ],
  }) + '\n```';
  const features = parseSplit(reply);
  assert.equal(features?.length, 3);
  assert.deepEqual(features?.[1], {
    name: 'Booking form', type: 'form_page',
    acceptance: ['A customer picks a date, time and party size.', 'Past dates are rejected.'],
  });
  // Missing criteria fall back to the type's defaults.
  assert.deepEqual(features?.[2]?.acceptance, DEFAULT_ACCEPTANCE.page);
});

test('unknown types, duplicates and extras are dropped; junk gives null', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ name: `Page ${i}`, type: 'page', acceptance: ['Shows it.'] }));
  assert.equal(parseSplit(JSON.stringify({ features: many }))?.length, MAX_SPLIT_FEATURES);
  const mixed = parseSplit(JSON.stringify({ features: [
    { name: 'Rocket', type: 'spaceship' }, { name: 'Home', type: 'page' }, { name: 'home', type: 'page' },
  ] }));
  assert.deepEqual(mixed?.map((f) => f.name), ['Home']);
  assert.equal(parseSplit('I cannot help with that.'), null);
  assert.equal(parseSplit('{"features": []}'), null);
});

test('the keyword split finds sign-in, records, forms and always a main page', () => {
  const names = ruleSplit('Customers book a table online; staff sign in to manage bookings.').map((f) => f.type);
  assert.deepEqual(names, ['auth', 'migration', 'crud_endpoint', 'form_page', 'page']);
  assert.deepEqual(ruleSplit('A page about my cafe').map((f) => f.type), ['page']);
});
