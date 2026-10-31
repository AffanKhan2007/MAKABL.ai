import type { Phase } from './estimator.ts';

// What real runs say a relay phase costs in tokens, so the estimate for spec, architect and
// review stops resting on typed-in guesses. Every finished phase of every past build logged
// its calls and tokens; this averages them per call.

export type MeasuredPhase = Exclude<Phase, 'build'>;

export interface MeasuredCall {
  /** Average tokens a call of this phase read and wrote. */
  inputPerCall: number;
  outputPerCall: number;
  /** Calls the average is taken over. */
  calls: number;
  /** Phase runs (builds) it comes from. */
  runs: number;
}

interface FinishedPayload {
  phase?: string;
  /** Recorded since the relay started counting calls: tokens summed over every call. */
  usage?: { input?: number; output?: number; calls?: number };
  /** Earlier runs recorded the single call of spec and architect only. */
  tokens?: { input?: number; output?: number };
}

const PHASES = new Set<string>(['spec', 'architect', 'review']);

export function aggregateMeasured(payloads: FinishedPayload[]): Partial<Record<MeasuredPhase, MeasuredCall>> {
  const sums = new Map<MeasuredPhase, { input: number; output: number; calls: number; runs: number }>();
  for (const p of payloads) {
    if (!p.phase || !PHASES.has(p.phase)) continue;
    const u = p.usage && (p.usage.calls ?? 0) > 0 ? p.usage : p.tokens ? { ...p.tokens, calls: 1 } : null;
    const input = u?.input ?? 0, output = u?.output ?? 0, calls = u?.calls ?? 0;
    if (!u || calls <= 0 || (input === 0 && output === 0)) continue;
    const phase = p.phase as MeasuredPhase;
    const s = sums.get(phase) ?? { input: 0, output: 0, calls: 0, runs: 0 };
    sums.set(phase, { input: s.input + input, output: s.output + output, calls: s.calls + calls, runs: s.runs + 1 });
  }
  const out: Partial<Record<MeasuredPhase, MeasuredCall>> = {};
  for (const [phase, s] of sums) {
    out[phase] = { inputPerCall: Math.round(s.input / s.calls), outputPerCall: Math.round(s.output / s.calls), calls: s.calls, runs: s.runs };
  }
  return out;
}
