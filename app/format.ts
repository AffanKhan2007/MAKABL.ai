import type { Range } from '../src/domain/types.ts';

// Display helpers shared by server and client components. No server-only imports here.

export const money = (micros: number): string =>
  `$${(micros / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const range = (r: Range): string => `${money(r.low)} – ${money(r.high)}`;

export const STATE_LABEL: Record<string, { text: string; tone: '' | 'good' | 'warn' | 'bad' }> = {
  draft: { text: 'Draft', tone: '' },
  scoped: { text: 'Scoped', tone: '' },
  planned: { text: 'Planned', tone: '' },
  costed: { text: 'Plan ready', tone: '' },
  approved: { text: 'Approved', tone: 'good' },
  building: { text: 'Building', tone: 'warn' },
  paused: { text: 'Paused', tone: 'bad' },
  verifying: { text: 'Features verified', tone: 'good' },
  preview: { text: 'Preview', tone: 'good' },
  live: { text: 'Live', tone: 'good' },
};

/** Feature rows on the intake form. */
export const FEATURE_ROWS = 8;

export const FEATURE_TYPES = [
  { value: 'auth', label: 'Sign-in / auth' },
  { value: 'crud_endpoint', label: 'Data API (CRUD)' },
  { value: 'form_page', label: 'Form page' },
  { value: 'page', label: 'Page / dashboard' },
  { value: 'migration', label: 'Database schema' },
  { value: 'integration', label: 'Third-party integration' },
] as const;
