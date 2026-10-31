import type { FeatureType } from '../calibration/runs.ts';
import type { Horizon } from '../domain/types.ts';
import { parseCriteria } from '../spec/acceptance.ts';
import { BUILD_MODELS, DEFAULT_RELAY, PRESETS, withPreset, type PresetId } from './plan.ts';
import type { ProjectSpec, SpecFeature } from './projects.ts';

// Validates the intake form (FR-01..FR-03) into a project spec. Shared by creating a
// project and by change requests, so both enforce the same rules.

export const FEATURE_ROWS = 8;
const FEATURE_TYPES = new Set<FeatureType>(['auth', 'crud_endpoint', 'form_page', 'page', 'migration', 'integration']);
const HORIZONS = new Set<Horizon>(['build_only', 'first_month', 'first_12_months']);

const text = (form: FormData, key: string): string => String(form.get(key) ?? '').trim();

export function parseIntake(form: FormData): { name: string; spec: ProjectSpec } | { error: string } {
  const name = text(form, 'name');
  const idea = text(form, 'idea');
  if (!name || name.length > 80) return { error: 'Give the project a name of up to 80 characters.' };
  if (!idea || idea.length > 2_000) return { error: 'Describe the app in up to 2,000 characters.' };

  const features: SpecFeature[] = [];
  for (let i = 0; i < FEATURE_ROWS; i++) {
    const fname = text(form, `feature_name_${i}`);
    if (!fname) continue;
    const type = text(form, `feature_type_${i}`) as FeatureType;
    if (!FEATURE_TYPES.has(type)) return { error: `Pick a type for "${fname}".` };
    if (fname.length > 80) return { error: 'Keep feature names to 80 characters.' };
    if (features.some((f) => f.name.toLowerCase() === fname.toLowerCase())) {
      return { error: `"${fname}" is listed twice.` };
    }
    const acceptance = parseCriteria(String(form.get(`feature_criteria_${i}`) ?? ''), type);
    if ('error' in acceptance) return { error: `${fname}: ${acceptance.error}` };
    features.push({ type, name: fname, acceptance });
  }
  if (features.length === 0) return { error: 'Add at least one feature.' };

  const horizon = text(form, 'horizon') as Horizon;
  if (!HORIZONS.has(horizon)) return { error: 'Pick a time horizon for the plan.' };
  const buildModel = text(form, 'model');
  if (!BUILD_MODELS.some((m) => m.id === buildModel)) return { error: 'Pick a build model.' };

  const visitorsRaw = text(form, 'visitors');
  const visitors = visitorsRaw === '' ? null : Number(visitorsRaw);
  if (visitors !== null && (!Number.isInteger(visitors) || visitors < 0 || visitors > 100_000_000)) {
    return { error: 'Expected monthly visitors must be a whole number up to 100,000,000.' };
  }

  const spec: ProjectSpec = {
    idea,
    features,
    commercialUse: form.get('commercial') === 'on',
    horizon,
    monthlyVisitors: visitors,
    buildModel,
    unpricedItems: text(form, 'unpriced').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10),
    // New projects run as a relay; the what-if explorer on the project page changes it.
    relay: DEFAULT_RELAY,
  };
  // Easy mode picks a quality level instead of models.
  const preset = text(form, 'preset');
  return { name, spec: preset in PRESETS ? withPreset(spec, preset as PresetId) : spec };
}
