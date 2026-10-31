import type { Micros } from '../domain/types.ts';
import type { Phase } from '../estimator/estimator.ts';

// Token negotiator (#18). The project cap is carved into one allowance per relay phase,
// in proportion to what the plan expects each phase to cost, with a share held back as
// slack. Before a phase makes a call it asks for the call's worst case; if its allowance
// is short, the negotiator grants from slack, then moves spare allowance from a phase
// that will not need it, and only then escalates to the Budget Gate, which owns the
// project cap and asks the user before crossing it. A finished phase hands back what it
// did not spend.
//
// Pure and deterministic: a resumed build replays the same calls from the Gate in the same
// order, so the negotiation replays too; the caller only skips re-recording decisions.

export const SLACK_SHARE = 0.2;

export type Outcome = 'granted' | 'reassigned' | 'escalated' | 'declined' | 'returned';

export interface Decision {
  phase: Phase;
  outcome: Outcome;
  /** What the phase asked for beyond its allowance (or handed back, for 'returned'). */
  amount: Micros;
  /** Phase the allowance came from, for 'reassigned'. */
  from?: Phase;
  reason: string;
  /** Who asked: the system (a call would not fit its allowance) or the model itself, with its own reason. */
  by?: 'system' | 'model';
}

export interface PhaseBudget {
  phase: Phase;
  allowance: Micros;
  spent: Micros;
  /** What the plan expected this phase to cost: a phase keeps at least this much. */
  expected: Micros;
  finished: boolean;
}

export class Negotiator {
  readonly phases: Map<Phase, PhaseBudget>;
  slack: Micros;
  readonly decisions: Decision[] = [];

  constructor(phases: PhaseBudget[], slack: Micros) {
    this.phases = new Map(phases.map((p) => [p.phase, { ...p }]));
    this.slack = slack;
  }

  /**
   * Allowances from the plan's expected cost per phase. If the cap is below the plan,
   * every allowance shrinks in proportion, so negotiation happens sooner, never later.
   */
  static fromPlan(cap: Micros, expected: Array<{ phase: Phase; expected: Micros }>): Negotiator {
    const total = expected.reduce((t, e) => t + e.expected, 0);
    const pool = Math.floor(cap * (1 - SLACK_SHARE));
    const phases = expected.map((e) => ({
      phase: e.phase,
      allowance: total > 0 ? Math.floor((pool * e.expected) / total) : Math.floor(pool / expected.length),
      spent: 0,
      expected: e.expected,
      finished: false,
    }));
    const handedOut = phases.reduce((t, p) => t + p.allowance, 0);
    return new Negotiator(phases, cap - handedOut);
  }

  private get(phase: Phase): PhaseBudget {
    const p = this.phases.get(phase);
    if (!p) throw new Error(`no allowance for phase ${phase}`);
    return p;
  }

  /** Spare allowance a phase can lend: above what it has spent and still expects to need. */
  private spare(p: PhaseBudget): Micros {
    if (p.finished) return 0;
    return Math.max(0, p.allowance - Math.max(p.spent, p.expected));
  }

  /**
   * Ask for room for a call costing up to `worstCase`. Returns the decision when the phase
   * had to negotiate, or null when its allowance already covered the call.
   */
  request(phase: Phase, worstCase: Micros, reason: string): Decision | null {
    const p = this.get(phase);
    const short = p.spent + worstCase - p.allowance;
    if (short <= 0) return null;
    return this.fund(phase, short, reason, 'system', 'escalated');
  }

  /**
   * A model asks for more room for its phase and says why. Answered the same way: from slack,
   * then from a phase that will not need its allowance, otherwise declined (the model keeps
   * working within what it has; if a call then does not fit, the Budget Gate asks the user).
   */
  ask(phase: Phase, amount: Micros, reason: string): Decision {
    return this.fund(phase, amount, reason, 'model', 'declined')!;
  }

  private fund(phase: Phase, need: Micros, reason: string, by: 'system' | 'model', failure: 'escalated' | 'declined'): Decision | null {
    const p = this.get(phase);
    let decision: Decision;
    if (this.slack >= need) {
      this.slack -= need;
      p.allowance += need;
      decision = { phase, outcome: 'granted', amount: need, reason, by };
    } else {
      const lender = [...this.phases.values()]
        .filter((o) => o.phase !== phase && this.spare(o) >= need - this.slack)
        .sort((a, b) => this.spare(b) - this.spare(a))[0];
      if (lender) {
        lender.allowance -= need - this.slack;
        p.allowance += need;
        this.slack = 0;
        decision = { phase, outcome: 'reassigned', amount: need, from: lender.phase, reason, by };
      } else {
        // Nothing left to move inside the cap. The allowance is NOT raised: the Budget Gate then
        // blocks the call against it and asks the user, who can raise the cap.
        decision = { phase, outcome: failure, amount: need, reason, by };
      }
    }
    this.decisions.push(decision);
    return decision;
  }

  /** Book what a call actually cost. */
  spend(phase: Phase, cost: Micros): void {
    this.get(phase).spent += cost;
  }

  /** A phase is done: its unspent allowance goes back to slack. */
  finish(phase: Phase): Decision | null {
    const p = this.get(phase);
    if (p.finished) return null;
    p.finished = true;
    const back = Math.max(0, p.allowance - p.spent);
    if (back === 0) return null;
    p.allowance -= back;
    this.slack += back;
    const decision: Decision = { phase, outcome: 'returned', amount: back, reason: `${phase} finished under its allowance` };
    this.decisions.push(decision);
    return decision;
  }

  snapshot(): { phases: PhaseBudget[]; slack: Micros } {
    return { phases: [...this.phases.values()].map((p) => ({ ...p })), slack: this.slack };
  }
}
