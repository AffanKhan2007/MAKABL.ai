import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ACCEPTANCE, parseCriteria, taskIdFor } from '../src/spec/acceptance.ts';
import { diffSpecs } from '../src/spec/diff.ts';
import { parseIntake } from '../src/server/intake.ts';
import type { ProjectSpec } from '../src/server/projects.ts';

test('empty criteria fall back to the type defaults; bullets are stripped', () => {
  assert.deepEqual(parseCriteria('  \n', 'auth'), DEFAULT_ACCEPTANCE.auth);
  assert.deepEqual(parseCriteria('- one\n* two\n\n• three', 'page'), ['one', 'two', 'three']);
  assert.ok('error' in (parseCriteria(Array(9).fill('x').join('\n'), 'page') as object));
  assert.ok('error' in (parseCriteria('y'.repeat(301), 'page') as object));
});

test('a task id is stable until the type or criteria change', () => {
  const f = { name: 'Items API', type: 'crud_endpoint' as const, acceptance: ['a', 'b'] };
  assert.equal(taskIdFor(f), taskIdFor({ ...f }));
  assert.match(taskIdFor(f), /^f-items-api-[0-9a-f]{8}$/);
  assert.notEqual(taskIdFor(f), taskIdFor({ ...f, acceptance: ['a', 'c'] }));
  assert.notEqual(taskIdFor(f), taskIdFor({ ...f, type: 'page' }));
});

const spec = (over: Partial<ProjectSpec> = {}): ProjectSpec => ({
  idea: 'x',
  features: [
    { name: 'Sign in', type: 'auth', acceptance: ['a'] },
    { name: 'Items API', type: 'crud_endpoint', acceptance: ['b'] },
    { name: 'Dashboard', type: 'page', acceptance: ['c'] },
  ],
  commercialUse: true, horizon: 'first_month', monthlyVisitors: 100,
  buildModel: 'anthropic/claude-opus-5-5', unpricedItems: [], ...over,
});

test('the spec diff sorts features into added, removed, changed and unchanged', () => {
  const before = spec();
  const after = spec({
    monthlyVisitors: 500,
    features: [
      { name: 'sign in', type: 'auth', acceptance: ['a'] },                // same, case differs
      { name: 'Items API', type: 'crud_endpoint', acceptance: ['b', 'b2'] }, // criteria changed
      { name: 'Reports', type: 'page', acceptance: ['d'] },                  // added
    ],
  });
  const d = diffSpecs(before, after);
  assert.deepEqual(d.unchanged.map((f) => f.name), ['sign in']);
  assert.deepEqual(d.changed.map((c) => [c.after.name, c.what]), [['Items API', ['acceptance criteria']]]);
  assert.deepEqual(d.added.map((f) => f.name), ['Reports']);
  assert.deepEqual(d.removed.map((f) => f.name), ['Dashboard']);
  assert.deepEqual(d.settings, ['expected traffic']);
});

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const base = {
  name: 'Shop', idea: 'An app', horizon: 'first_month', model: 'anthropic/claude-opus-5-5', visitors: '100',
  feature_type_0: 'auth', feature_name_0: 'Sign in', feature_criteria_0: '',
};

test('intake parsing applies default criteria and rejects bad input', () => {
  const ok = parseIntake(form(base));
  assert.ok(!('error' in ok));
  if ('error' in ok) return;
  assert.deepEqual(ok.spec.features[0]!.acceptance, DEFAULT_ACCEPTANCE.auth);
  assert.equal(ok.spec.commercialUse, false);

  assert.match((parseIntake(form({ ...base, feature_name_0: '' })) as { error: string }).error, /at least one feature/);
  assert.match((parseIntake(form({ ...base, feature_type_0: 'rocket' })) as { error: string }).error, /Pick a type/);
  assert.match((parseIntake(form({ ...base, model: 'gpt' })) as { error: string }).error, /build model/);
  assert.match((parseIntake(form({ ...base, visitors: '-3' })) as { error: string }).error, /whole number/);
  assert.match((parseIntake(form({ ...base, feature_type_1: 'page', feature_name_1: 'sign IN' })) as { error: string }).error, /twice/);
});
