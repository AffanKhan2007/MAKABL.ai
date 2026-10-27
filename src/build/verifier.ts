import type { CommandResult, Workspace } from './workspace.ts';

// Verifier (working model section 10). Runs platform-defined checks and reports exactly
// what passed. The model never supplies a command; it can only ask for these to run.
// A task is Verified only when every required check passed (FR-22).

export interface CheckSpec {
  name: string;
  gate: 'G2' | 'G3' | 'G4';
  command: readonly string[];
  timeoutMs: number;
  /**
   * Who wrote the tests this check runs. Agent-written tests passing only shows the code
   * matches tests the same model wrote (section 10), so the report says so.
   */
  testsAuthoredBy: 'platform' | 'user' | 'agent' | 'none';
}

export interface CheckResult extends CommandResult {
  name: string;
  gate: CheckSpec['gate'];
  passed: boolean;
  testsAuthoredBy: CheckSpec['testsAuthoredBy'];
}

export class Verifier {
  private readonly checks: readonly CheckSpec[];

  constructor(checks: readonly CheckSpec[]) {
    if (checks.length === 0) throw new Error('a verifier needs at least one check');
    this.checks = checks;
  }

  get names(): string[] {
    return this.checks.map((c) => c.name);
  }

  /** Run every check in order; a failure does not stop the rest, so the report is complete. */
  async runAll(ws: Workspace): Promise<CheckResult[]> {
    const results: CheckResult[] = [];
    for (const c of this.checks) {
      const r = await ws.run(c.command, c.timeoutMs);
      results.push({
        ...r, name: c.name, gate: c.gate, testsAuthoredBy: c.testsAuthoredBy,
        passed: r.exitCode === 0 && !r.timedOut,
      });
    }
    return results;
  }
}

export const allPassed = (results: readonly CheckResult[]): boolean => results.every((r) => r.passed);

/** Compact text for the model and the event feed: what failed and the tail of its output. */
export function summarize(results: readonly CheckResult[], outputChars = 1_500): string {
  return results.map((r) => {
    const status = r.passed ? 'PASS' : r.timedOut ? 'TIMEOUT' : `FAIL (exit ${r.exitCode})`;
    return r.passed ? `${r.name}: ${status}` : `${r.name}: ${status}\n${r.output.slice(-outputChars)}`;
  }).join('\n\n');
}
