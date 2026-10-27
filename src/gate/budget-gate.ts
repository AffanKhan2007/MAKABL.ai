import { fmtUsd, type CostBasis, type Micros } from '../domain/types.ts';
import type { EventType } from '../events/event-store.ts';
import type {
  ApprovalRequest, Budget, GateStore, GateTx, LedgerEntry, NewApproval,
} from './store.ts';

export type { ApprovalKind, ApprovalRequest, Budget, LedgerEntry } from './store.ts';

// Budget Gate (working model 7.4). The single choke point for paid calls.
//
// 1. Reserve a worst-case cost inside a per-project transaction, checking
//    spent + reserved + worst_case <= min(task ceiling, project cap, monthly cap).
// 2. Make the call with the issued BudgetToken (adapters refuse to run without one).
// 3. Settle the reservation to the observed cost from the response usage fields.
// Blocked calls never reach the provider; they pause the task and open an approval.
//
// The reservation (keyed by an idempotency key) is committed before any side effect, so a
// step re-run after an approval pause replays the stored result instead of paying twice.
// Only check-and-reserve and settle hold the project lock; the paid call runs outside it.

export interface PaidCallRequest {
  projectId: string;
  taskId: string;
  taskCeiling: Micros;
  idempotencyKey: string;
  worstCase: Micros;
  description: string;
}

/** Proof that the Gate authorised a call. Adapters require it in execute(). */
export interface BudgetToken {
  readonly reservationId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly worstCase: Micros;
}

export type AuthorizeResult =
  | { ok: true; token: BudgetToken }
  | { ok: true; replay: true; result: unknown }
  | { ok: false; approval: ApprovalRequest; reason: string };

/**
 * An earlier call under this idempotency key threw after it was reserved. Whether the
 * provider charged is unknown (its worst case was booked), and there is no result to
 * replay, so a retry must use a new key.
 */
export class FailedAttemptReplayError extends Error {}

export class BudgetBlockedError extends Error {
  readonly approval: ApprovalRequest;
  constructor(reason: string, approval: ApprovalRequest) {
    super(reason);
    this.approval = approval;
  }
}

type Emit = (type: EventType, taskId: string | null, payload: Record<string, unknown>) => Promise<void>;

export class BudgetGate {
  private readonly store: GateStore;
  private readonly now: () => Date;

  constructor(store: GateStore, now: () => Date = () => new Date()) {
    this.store = store;
    this.now = now;
  }

  async setBudget(projectId: string, budget: Budget): Promise<void> {
    await this.store.withProject(projectId, (tx) => tx.setBudget(projectId, budget));
  }

  async getBudget(projectId: string): Promise<Budget> {
    return this.store.withProject(projectId, (tx) => this.budgetOf(tx, projectId));
  }

  spent(projectId: string): Promise<Micros> {
    return this.store.spent(projectId);
  }

  ledgerFor(projectId: string): Promise<LedgerEntry[]> {
    return this.store.ledger(projectId);
  }

  pendingApprovals(projectId: string): Promise<ApprovalRequest[]> {
    return this.store.pendingApprovals(projectId);
  }

  /** Check and reserve atomically per project. Never calls a provider. */
  authorize(req: PaidCallRequest): Promise<AuthorizeResult> {
    return this.store.withProject(req.projectId, async (tx) => {
      const emit = this.emitter(tx, req.projectId);
      const month = this.month();

      const existing = await tx.findReservation(req.projectId, req.idempotencyKey);
      if (existing?.status === 'settled' && existing.failed) {
        throw new FailedAttemptReplayError(
          `the call under ${req.idempotencyKey} failed earlier and was booked at its worst case; retry with a new key`,
        );
      }
      if (existing?.status === 'settled') {
        await emit('idempotent_replay', req.taskId, { idempotencyKey: req.idempotencyKey });
        return { ok: true, replay: true, result: existing.result };
      }
      if (existing?.status === 'held') {
        // The earlier attempt may have reached the provider; we cannot know. Refuse a
        // second concurrent call under the same key rather than risk paying twice.
        throw new Error(`reservation ${existing.id} for ${req.idempotencyKey} is still in flight`);
      }

      const budget = await this.budgetOf(tx, req.projectId);
      const checks: Array<[string, Micros, Micros]> = [
        ['task ceiling', await tx.committed(req.projectId, { taskId: req.taskId }), req.taskCeiling],
        ['project cap', await tx.committed(req.projectId, {}), budget.projectCap],
        ['monthly cap', await tx.committed(req.projectId, { month }), budget.monthlyCap],
      ];
      for (const [name, used, cap] of checks) {
        if (used + req.worstCase <= cap) continue;
        const reason =
          `${name} would be exceeded: ${fmtUsd(used)} committed + ${fmtUsd(req.worstCase)} ` +
          `worst case > ${fmtUsd(cap)}`;
        const approval = await this.openApproval(tx, {
          projectId: req.projectId,
          kind: 'budget_raise',
          reason,
          blockedTaskId: req.taskId,
          costRange: { low: 0, high: req.worstCase },
          alternatives: [
            'Raise the cap by at least the worst-case amount and resume',
            'Switch this task to a cheaper model and retry',
            'Stop the task and keep the work done so far',
          ],
          whoBills: 'Your own model provider account (BYO key)',
          cancellable: 'Yes; usage-based, no commitment',
          consequenceOfDeclining: `Task ${req.taskId} stays paused; nothing further is charged`,
        });
        await emit('budget_blocked', req.taskId, { check: name, used, worstCase: req.worstCase, cap });
        await emit('task_paused', req.taskId, { approvalId: approval.id });
        return { ok: false, approval, reason };
      }

      let reservationId: string;
      if (existing) {
        // Released earlier: that attempt never charged, so the key can be reused.
        await tx.reopenReservation(existing.id, req.worstCase, month);
        reservationId = existing.id;
      } else {
        const r = await tx.insertReservation({
          projectId: req.projectId, taskId: req.taskId, idempotencyKey: req.idempotencyKey,
          worstCase: req.worstCase, month,
        });
        reservationId = r.id;
      }
      await emit('budget_reserved', req.taskId, { reservationId, worstCase: req.worstCase });
      return {
        ok: true,
        token: Object.freeze({ reservationId, projectId: req.projectId, taskId: req.taskId, worstCase: req.worstCase }),
      };
    });
  }

  /** Replace the reservation with the observed cost and write the ledger entry. */
  settle(
    token: BudgetToken, observed: Micros, description: string, result?: unknown,
    basis: CostBasis = 'usage_observed',
  ): Promise<void> {
    return this.settleInternal(token, observed, description, result, basis, false);
  }

  private settleInternal(
    token: BudgetToken, observed: Micros, description: string, result: unknown,
    basis: CostBasis, failed: boolean,
  ): Promise<void> {
    return this.store.withProject(token.projectId, async (tx) => {
      await this.heldReservation(tx, token);
      await tx.settleReservation(token.reservationId, observed, result, failed);
      await tx.insertLedger({
        projectId: token.projectId, taskId: token.taskId, reservationId: token.reservationId,
        amount: observed, basis, description,
      });
      const emit = this.emitter(tx, token.projectId);
      await emit('budget_settled', token.taskId, {
        reservationId: token.reservationId, observed, basis, worstCase: token.worstCase,
      });
      if (observed > token.worstCase) {
        // Only possible if the worst-case formula or a price is wrong. Disclose it (NFR-07).
        await emit('budget_overshoot', token.taskId, {
          reservationId: token.reservationId, by: observed - token.worstCase,
        });
      }
    });
  }

  /** The call was never sent, so nothing was charged. */
  release(token: BudgetToken): Promise<void> {
    return this.store.withProject(token.projectId, async (tx) => {
      await this.heldReservation(tx, token);
      await tx.releaseReservation(token.reservationId);
      await this.emitter(tx, token.projectId)('budget_released', token.taskId, { reservationId: token.reservationId });
    });
  }

  /**
   * Authorize, run, settle. If the call throws we cannot tell whether the provider
   * charged, so the full worst case is booked as 'estimated' rather than dropped.
   */
  async execute<T>(
    req: PaidCallRequest,
    call: (token: BudgetToken) => Promise<{ result: T; observed: Micros; basis?: CostBasis }>,
  ): Promise<T> {
    const auth = await this.authorize(req);
    if (!auth.ok) throw new BudgetBlockedError(auth.reason, auth.approval);
    if ('replay' in auth) return auth.result as T;
    let outcome: { result: T; observed: Micros; basis?: CostBasis };
    try {
      outcome = await call(auth.token);
    } catch (err) {
      await this.settleInternal(
        auth.token, auth.token.worstCase, `${req.description} (failed; charge unknown)`, undefined, 'estimated', true,
      );
      throw err;
    }
    await this.settle(auth.token, outcome.observed, req.description, outcome.result, outcome.basis);
    return outcome.result;
  }

  /**
   * New paid resources and recurring charges always need explicit approval, whatever
   * budget remains (7.4 step 5). Returns approved only for an approved request.
   */
  requireDiscreteApproval(
    projectId: string,
    approvalId: string | null,
    draft: Omit<NewApproval, 'projectId'> & { kind: 'paid_resource' | 'recurring_charge' },
  ): Promise<{ approved: true } | { approved: false; approval: ApprovalRequest }> {
    return this.store.withProject(projectId, async (tx) => {
      if (approvalId) {
        const a = await tx.getApproval(approvalId);
        if (a && a.projectId === projectId && a.kind === draft.kind && a.status === 'approved') {
          return { approved: true as const };
        }
      }
      return { approved: false as const, approval: await this.openApproval(tx, { projectId, ...draft }) };
    });
  }

  /** Decide an approval. Approving a budget raise lifts both caps by `raiseBy`. */
  decide(projectId: string, approvalId: string, decision: 'approved' | 'declined', raiseBy: Micros = 0): Promise<ApprovalRequest> {
    return this.store.withProject(projectId, async (tx) => {
      const a = await tx.getApproval(approvalId);
      if (!a || a.projectId !== projectId) throw new Error(`unknown approval ${approvalId}`);
      if (a.status !== 'pending') throw new Error(`approval ${approvalId} already ${a.status}`);
      await tx.setApprovalStatus(approvalId, decision);
      if (decision === 'approved' && a.kind === 'budget_raise' && raiseBy > 0) {
        const b = await this.budgetOf(tx, projectId);
        await tx.setBudget(projectId, { projectCap: b.projectCap + raiseBy, monthlyCap: b.monthlyCap + raiseBy });
      }
      const emit = this.emitter(tx, projectId);
      await emit('approval_decided', a.blockedTaskId, { approvalId, decision, raiseBy });
      if (decision === 'approved' && a.blockedTaskId) await emit('task_resumed', a.blockedTaskId, { approvalId });
      return { ...a, status: decision };
    });
  }

  private async openApproval(tx: GateTx, draft: NewApproval): Promise<ApprovalRequest> {
    const approval = await tx.insertApproval(draft);
    await this.emitter(tx, draft.projectId)('approval_requested', draft.blockedTaskId, {
      approvalId: approval.id, kind: draft.kind, reason: draft.reason,
    });
    return approval;
  }

  private async budgetOf(tx: GateTx, projectId: string): Promise<Budget> {
    const b = await tx.getBudget(projectId);
    if (!b) throw new Error(`no budget set for project ${projectId}`);
    return b;
  }

  private async heldReservation(tx: GateTx, token: BudgetToken): Promise<void> {
    const r = await tx.getReservation(token.reservationId);
    if (!r || r.projectId !== token.projectId) throw new Error(`unknown reservation ${token.reservationId}`);
    if (r.status !== 'held') throw new Error(`reservation ${r.id} already ${r.status}`);
  }

  private emitter(tx: GateTx, projectId: string): Emit {
    return (type, taskId, payload) => tx.appendEvent({ projectId, taskId, type, payload });
  }

  private month(): string {
    return this.now().toISOString().slice(0, 7);
  }
}
