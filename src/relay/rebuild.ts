// Rebuilding a feature that is already built. A finished feature is skipped, and its model calls
// replay free from the Gate by key, so a changed render or new instruction would change nothing.
// A rebuild request starts a new round for the features it names: their task ids get a round
// suffix, so they are built again with new calls, from the current renders and instructions.

export interface RebuildRequest { n: number; features: string[] | 'all' }

/** The latest round a feature was asked to be rebuilt in; 0 if never. */
export function roundOf(requests: RebuildRequest[], feature: string): number {
  return requests.filter((r) => r.features === 'all' || r.features.includes(feature)).reduce((m, r) => Math.max(m, r.n), 0);
}

export const withRound = (taskId: string, round: number): string => (round ? `${taskId}:r${round}` : taskId);

export function rebuildRequests(events: Array<{ type: string; payload: Record<string, unknown> }>): RebuildRequest[] {
  return events.filter((e) => e.type === 'rebuild_requested').map((e, i) => ({
    n: i + 1, features: e.payload.features === 'all' ? 'all' : (e.payload.features as string[] ?? []),
  }));
}
