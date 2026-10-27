import type { ProjectSpec, SpecFeature } from '../server/projects.ts';
import { taskIdFor } from './acceptance.ts';

// What a change request changes (FR-29): features matched by name across two spec
// versions. A feature whose type or criteria changed gets a new task id and is rebuilt;
// an unchanged one keeps its task id, so if it was verified it is not built again.

export interface SpecDiff {
  added: SpecFeature[];
  removed: SpecFeature[];
  changed: Array<{ before: SpecFeature; after: SpecFeature; what: string[] }>;
  unchanged: SpecFeature[];
  /** Plan-level fields that changed (traffic, horizon, model, ...). */
  settings: string[];
}

const key = (f: SpecFeature) => f.name.toLowerCase();

export function diffSpecs(before: ProjectSpec, after: ProjectSpec): SpecDiff {
  const old = new Map(before.features.map((f) => [key(f), f]));
  const now = new Map(after.features.map((f) => [key(f), f]));
  const diff: SpecDiff = { added: [], removed: [], changed: [], unchanged: [], settings: [] };

  for (const f of after.features) {
    const prev = old.get(key(f));
    if (!prev) { diff.added.push(f); continue; }
    if (taskIdFor(prev) === taskIdFor(f)) { diff.unchanged.push(f); continue; }
    const what: string[] = [];
    if (prev.type !== f.type) what.push('type');
    if (prev.acceptance.join('\n') !== f.acceptance.join('\n')) what.push('acceptance criteria');
    diff.changed.push({ before: prev, after: f, what });
  }
  for (const f of before.features) if (!now.has(key(f))) diff.removed.push(f);

  if (before.idea !== after.idea) diff.settings.push('description');
  if (before.commercialUse !== after.commercialUse) diff.settings.push('commercial use');
  if (before.horizon !== after.horizon) diff.settings.push('plan horizon');
  if (before.monthlyVisitors !== after.monthlyVisitors) diff.settings.push('expected traffic');
  if (before.buildModel !== after.buildModel) diff.settings.push('build model');
  if (before.unpricedItems.join('|') !== after.unpricedItems.join('|')) diff.settings.push('unpriced items');
  return diff;
}
