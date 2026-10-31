// Quality against cost, per feature. Quality is a score out of 100 built only from things the
// system measured: the checks passing (less for each retry), how much of the chosen render's
// colours and wording is in the code, and the reviewer's verdict. A part with no measurement
// (no render, no review) is left out and the rest rescaled, so a missing part never counts as
// a pass or a fail.

export interface QualityInput {
  verified: boolean;
  attempts: number;
  /** 0..1, or null when the feature had no render to compare with. */
  fidelity: number | null;
  /** 'APPROVE', 'REVISE', or null when no review ran. */
  verdict: string | null;
}

export const QUALITY_WEIGHTS = { checks: 40, fidelity: 40, review: 20 } as const;

export function qualityScore(i: QualityInput): { score: number; parts: Array<{ name: string; got: number; of: number }> } {
  const parts: Array<{ name: string; got: number; of: number }> = [{
    name: 'checks passed', of: QUALITY_WEIGHTS.checks,
    got: i.verified ? Math.max(0.4, 1 - 0.2 * Math.max(0, i.attempts - 1)) * QUALITY_WEIGHTS.checks : 0,
  }];
  if (i.fidelity !== null) parts.push({ name: 'matches the render', of: QUALITY_WEIGHTS.fidelity, got: i.fidelity * QUALITY_WEIGHTS.fidelity });
  if (i.verdict) parts.push({ name: 'reviewer', of: QUALITY_WEIGHTS.review, got: i.verdict === 'APPROVE' ? QUALITY_WEIGHTS.review : QUALITY_WEIGHTS.review * 0.4 });
  const of = parts.reduce((t, p) => t + p.of, 0);
  return { score: Math.round((parts.reduce((t, p) => t + p.got, 0) / of) * 100), parts };
}

export interface FeaturePoint { feature: string; cost: number; cumulative: number; score: number }

/** One point per built feature, in build order, with the cost of everything spent on it. */
export function featurePoints(
  features: Array<{ name: string; taskId: string }>,
  events: Array<{ type: string; taskId: string | null; payload: Record<string, unknown> }>,
  costByTask: Map<string, number>,
): FeaturePoint[] {
  const out: FeaturePoint[] = [];
  let cumulative = 0;
  for (const f of features) {
    const verified = events.filter((e) => e.type === 'task_verified' && e.taskId === f.taskId).at(-1);
    if (!verified) continue;
    const fid = events.filter((e) => e.type === 'relay_fidelity' && e.taskId === f.taskId).at(-1);
    const rev = events.filter((e) => e.type === 'relay_review' && e.taskId === `review:${f.taskId}`).at(-1);
    const cost = [f.taskId, `${f.taskId}:align`, `review:${f.taskId}`, `review:oversee:${f.taskId}`]
      .reduce((t, id) => t + (costByTask.get(id) ?? 0), 0);
    cumulative += cost;
    out.push({
      feature: f.name, cost, cumulative,
      score: qualityScore({
        verified: true, attempts: Number(verified.payload.attempts ?? 1),
        fidelity: fid ? Number(fid.payload.score) : null, verdict: rev ? String(rev.payload.verdict ?? '') || null : null,
      }).score,
    });
  }
  return out;
}
