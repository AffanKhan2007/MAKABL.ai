import type { FeatureType } from '../calibration/runs.ts';
import type { SpecFeature } from '../server/projects.ts';
import { DEFAULT_ACCEPTANCE, parseCriteria } from './acceptance.ts';

// Splitting a one-line prompt into features (FR-01, FR-03). A model proposes the split as
// JSON; parseSplit accepts only what the intake form would accept. ruleSplit is the
// fallback when no model can be called, and is labelled as such wherever it is shown.

export const MAX_SPLIT_FEATURES = 6;
const TYPES: readonly FeatureType[] = ['auth', 'migration', 'crud_endpoint', 'form_page', 'page', 'integration'];

export const SPLIT_SYSTEM = [
  'You split a description of a small web app into the features a builder will make, one at a time.',
  `Return JSON only, no prose: {"features":[{"name":string,"type":string,"acceptance":[string]}]}.`,
  `Use 1 to ${MAX_SPLIT_FEATURES} features. "type" is one of:`,
  '- auth: people sign up, sign in and sign out',
  '- migration: where data is stored (tables)',
  '- crud_endpoint: create, read, update and delete records through an API',
  '- form_page: a page with a form someone fills in',
  '- page: a page that shows information',
  '- integration: a connection to another service (payments, email, maps)',
  'Names are short and plain (under 40 characters). Give each feature 1 to 3 acceptance criteria:',
  'concrete, checkable sentences about what a user can do or see. Only include what the description asks for.',
].join('\n');

export const splitPrompt = (idea: string): string => `App description:\n${idea}`;

/** The first JSON object in a model's reply. */
function jsonIn(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

/** A model's split as spec features, or null when the reply is unusable. */
export function parseSplit(text: string): SpecFeature[] | null {
  const raw = (jsonIn(text) as { features?: unknown } | null)?.features;
  if (!Array.isArray(raw)) return null;
  const features: SpecFeature[] = [];
  for (const f of raw.slice(0, MAX_SPLIT_FEATURES)) {
    if (typeof f !== 'object' || f === null) continue;
    const { name, type, acceptance } = f as { name?: unknown; type?: unknown; acceptance?: unknown };
    if (typeof name !== 'string' || !TYPES.includes(type as FeatureType)) continue;
    const clean = name.trim().slice(0, 80);
    if (!clean || features.some((x) => x.name.toLowerCase() === clean.toLowerCase())) continue;
    const lines = Array.isArray(acceptance) ? acceptance.filter((a): a is string => typeof a === 'string') : [];
    const criteria = parseCriteria(lines.slice(0, 5).map((a) => a.slice(0, 199)).join('\n'), type as FeatureType);
    features.push({ name: clean, type: type as FeatureType, acceptance: 'error' in criteria ? [...DEFAULT_ACCEPTANCE[type as FeatureType]] : criteria });
  }
  return features.length ? features : null;
}

const RULES: Array<{ match: RegExp; features: Array<{ type: FeatureType; name: string }> }> = [
  { match: /\b(sign[ -]?in|log[ -]?in|account|users?|staff|members?|customers? log)/i, features: [{ type: 'auth', name: 'Sign-in' }] },
  {
    match: /\b(list|manage|track|stock|inventory|menu|products?|items?|records?|bookings?|orders?|clients?|tasks?)\b/i,
    features: [{ type: 'migration', name: 'Data storage' }, { type: 'crud_endpoint', name: 'Manage records' }],
  },
  { match: /\b(book|order|form|submit|contact|register|apply|request|sign up)\b/i, features: [{ type: 'form_page', name: 'Customer form' }] },
  { match: /\b(pay|payments?|stripe|email|sms|maps?|calendar)\b/i, features: [{ type: 'integration', name: 'Connected service' }] },
];

/** A keyword split for when no model is available; always includes a main page. */
export function ruleSplit(idea: string): SpecFeature[] {
  const picked = RULES.filter((r) => r.match.test(idea)).flatMap((r) => r.features);
  const all = [...picked, { type: 'page' as FeatureType, name: 'Main page' }];
  return all.map((f) => ({ ...f, acceptance: [...DEFAULT_ACCEPTANCE[f.type]] }));
}
