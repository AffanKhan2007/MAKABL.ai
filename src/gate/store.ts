import type { CostBasis, Micros } from '../domain/types.ts';
import type { ActivityEvent, NewEvent } from '../events/event-store.ts';

// Storage contract for the Budget Gate. The Gate holds all the decision logic; a store
// only has to give it an exclusive, atomic transaction per project. Implementations:
// MemoryGateStore (tests, demo) and PgGateStore (row lock on budgets + one DB transaction).

export interface Budget {
  projectCap: Micros;
  monthlyCap: Micros;
}

export type ReservationStatus = 'held' | 'settled' | 'released';

export interface Reservation {
  id: string;
  projectId: string;
  taskId: string;
  idempotencyKey: string;
  worstCase: Micros;
  status: ReservationStatus;
  month: string;              // YYYY-MM, for the monthly cap
  observed: Micros | null;
  result: unknown;
  /** The call threw after its reservation, so its result is unknown and must not replay. */
  failed: boolean;
}

export interface LedgerEntry {
  projectId: string;
  taskId: string;
  reservationId: string;
  amount: Micros;
  basis: CostBasis;
  description: string;
}

export type ApprovalKind = 'budget_raise' | 'paid_resource' | 'recurring_charge';
export type ApprovalStatus = 'pending' | 'approved' | 'declined';

export interface ApprovalRequest {
  id: string;
  projectId: string;
  kind: ApprovalKind;
  status: ApprovalStatus;
  // FR-14 fields
  reason: string;
  blockedTaskId: string | null;
  costRange: { low: Micros; high: Micros };
  alternatives: string[];
  whoBills: string;
  cancellable: string;
  consequenceOfDeclining: string;
}

export type NewApproval = Omit<ApprovalRequest, 'id' | 'status'>;

/** Operations available inside one project transaction. */
export interface GateTx {
  getBudget(projectId: string): Promise<Budget | null>;
  setBudget(projectId: string, budget: Budget): Promise<void>;
  /** Settled amounts plus held worst cases; released reservations count as zero. */
  committed(projectId: string, filter: { taskId?: string; month?: string }): Promise<Micros>;
  findReservation(projectId: string, idempotencyKey: string): Promise<Reservation | null>;
  heldReservations(projectId: string): Promise<Reservation[]>;
  getReservation(id: string): Promise<Reservation | null>;
  insertReservation(r: Omit<Reservation, 'id' | 'status' | 'observed' | 'result' | 'failed'>): Promise<Reservation>;
  /** Reuse a released reservation's key for a fresh attempt. */
  reopenReservation(id: string, worstCase: Micros, month: string): Promise<void>;
  settleReservation(id: string, observed: Micros, result: unknown, failed: boolean): Promise<void>;
  releaseReservation(id: string): Promise<void>;
  insertLedger(e: LedgerEntry): Promise<void>;
  insertApproval(a: NewApproval): Promise<ApprovalRequest>;
  getApproval(id: string): Promise<ApprovalRequest | null>;
  /** `decidedBy` is the deciding user's id, recorded for the audit log (FR-28). */
  setApprovalStatus(id: string, status: ApprovalStatus, decidedBy: string | null): Promise<void>;
  /** Events become visible to subscribers only if the transaction commits. */
  appendEvent(e: NewEvent): Promise<void>;
}

export interface GateStore {
  /**
   * Run fn holding an exclusive lock on the project. Everything fn writes commits
   * together, or nothing does if fn throws.
   */
  withProject<T>(projectId: string, fn: (tx: GateTx) => Promise<T>): Promise<T>;
  spent(projectId: string): Promise<Micros>;
  ledger(projectId: string): Promise<LedgerEntry[]>;
  pendingApprovals(projectId: string): Promise<ApprovalRequest[]>;
}

export type { ActivityEvent };
