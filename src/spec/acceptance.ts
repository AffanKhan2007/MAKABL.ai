import { createHash } from 'node:crypto';
import type { FeatureType } from '../calibration/runs.ts';

// Acceptance criteria (FR-03): every feature carries testable criteria the user approves
// with the plan. These defaults per feature type are a starting point the user edits;
// they come from the platform, not a model, so producing them costs nothing.

export const DEFAULT_ACCEPTANCE: Record<FeatureType, string[]> = {
  auth: [
    'A signed-out visitor who opens a private page is sent to sign in.',
    'A user can sign up, sign in and sign out.',
    "One user can never see or change another user's data.",
  ],
  crud_endpoint: [
    'The owner can create, read, update and delete their records.',
    'Invalid input is rejected with a clear error and nothing is saved.',
    'Users only ever see and change their own records.',
  ],
  form_page: [
    'Required fields are checked before saving, with a message next to each problem.',
    'After saving, the user sees a confirmation and the saved values.',
    'The form can be completed with the keyboard alone.',
  ],
  page: [
    'The page shows the data it is for, for the signed-in user only.',
    'With no data yet, the page says what to do next instead of showing nothing.',
    'The page is usable on a phone-width screen.',
  ],
  migration: [
    'The schema applies cleanly to an empty database.',
    'Tables have the keys and constraints the features rely on.',
    "Access rules stop users from reading each other's rows.",
  ],
  integration: [
    'Errors and timeouts from the outside service are handled with a clear message.',
    'Credentials come from configuration, never from the code.',
    'The rest of the app keeps working when the service is unavailable.',
  ],
};

export const MAX_CRITERIA = 8;
export const MAX_CRITERION_LENGTH = 300;

/** Criteria from a textarea, one per line; the type's defaults when left empty. */
export function parseCriteria(raw: string, type: FeatureType): string[] | { error: string } {
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
  if (lines.length === 0) return [...DEFAULT_ACCEPTANCE[type]];
  if (lines.length > MAX_CRITERIA) return { error: `Use at most ${MAX_CRITERIA} acceptance criteria per feature.` };
  if (lines.some((l) => l.length > MAX_CRITERION_LENGTH)) {
    return { error: `Keep each acceptance criterion under ${MAX_CRITERION_LENGTH} characters.` };
  }
  return lines;
}

export const featureSlug = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'feature';

/**
 * A feature's build task id. Stable while its name, type and criteria are unchanged, so
 * an edited spec rebuilds only the features that actually changed.
 */
export function taskIdFor(feature: { name: string; type: FeatureType; acceptance: string[] }): string {
  const digest = createHash('sha256').update([feature.type, ...feature.acceptance].join('\n')).digest('hex');
  return `f-${featureSlug(feature.name)}-${digest.slice(0, 8)}`;
}
