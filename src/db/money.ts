import type { Micros } from '../domain/types.ts';

// numeric(12,6) dollars <-> integer micros, exactly. pg returns numeric as a string.

export function toNumeric(m: Micros): string {
  if (!Number.isSafeInteger(m)) throw new Error(`micros must be a safe integer: ${m}`);
  const sign = m < 0 ? '-' : '';
  const abs = Math.abs(m);
  return `${sign}${Math.floor(abs / 1_000_000)}.${String(abs % 1_000_000).padStart(6, '0')}`;
}

export function fromNumeric(s: string | null): Micros {
  if (s === null) return 0;
  const [whole = '0', frac = ''] = s.replace('-', '').split('.');
  const m = Number(whole) * 1_000_000 + Number(frac.padEnd(6, '0').slice(0, 6));
  return s.startsWith('-') ? -m : m;
}
