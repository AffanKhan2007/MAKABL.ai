import type { Micros } from '../domain/types.ts';
import type { MemoryEventLog, NewEvent } from '../events/event-store.ts';
import type {
  ApprovalRequest, Budget, GateStore, GateTx, LedgerEntry, Reservation,
} from './store.ts';

// In-memory GateStore for tests and the demo. A per-project promise chain stands in for
// the row lock, and state is snapshotted per transaction so a throw rolls back, matching
// PgGateStore semantics. Events are buffered and published only on commit.

interface State {
  budgets: Map<string, Budget>;
  reservations: Map<string, Reservation>;
  ledger: LedgerEntry[];
  approvals: Map<string, ApprovalRequest>;
}

export class MemoryGateStore implements GateStore {
  private state: State = {
    budgets: new Map(), reservations: new Map(), ledger: [], approvals: new Map(),
  };
  private readonly locks = new Map<string, Promise<void>>();
  private nextId = 0;
  private readonly events: MemoryEventLog;

  constructor(events: MemoryEventLog) {
    this.events = events;
  }

  async withProject<T>(projectId: string, fn: (tx: GateTx) => Promise<T>): Promise<T> {
    const prev = this.locks.get(projectId) ?? Promise.resolve();
    let unlock!: () => void;
    const mine = prev.then(() => new Promise<void>((r) => { unlock = r; }));
    this.locks.set(projectId, mine);
    await prev;

    const snapshot = structuredClone(this.state);
    const pending: NewEvent[] = [];
    try {
      const result = await fn(this.tx(pending));
      this.events.commit(pending);
      return result;
    } catch (err) {
      this.state = snapshot;
      throw err;
    } finally {
      unlock();
      if (this.locks.get(projectId) === mine) this.locks.delete(projectId);
    }
  }

  async spent(projectId: string): Promise<Micros> {
    return this.state.ledger.filter((e) => e.projectId === projectId).reduce((s, e) => s + e.amount, 0);
  }

  async ledger(projectId: string): Promise<LedgerEntry[]> {
    return this.state.ledger.filter((e) => e.projectId === projectId);
  }

  async pendingApprovals(projectId: string): Promise<ApprovalRequest[]> {
    return [...this.state.approvals.values()].filter((a) => a.projectId === projectId && a.status === 'pending');
  }

  private tx(pending: NewEvent[]): GateTx {
    // Read this.state on every call: a rollback replaces the object.
    const s = () => this.state;
    const res = (id: string) => {
      const r = s().reservations.get(id);
      if (!r) throw new Error(`unknown reservation ${id}`);
      return r;
    };
    return {
      getBudget: async (p) => s().budgets.get(p) ?? null,
      setBudget: async (p, b) => { s().budgets.set(p, { ...b }); },
      committed: async (p, f) => {
        let total = 0;
        for (const r of s().reservations.values()) {
          if (r.projectId !== p || r.status === 'released') continue;
          if (f.taskId && r.taskId !== f.taskId) continue;
          if (f.month && r.month !== f.month) continue;
          total += r.status === 'settled' ? r.observed! : r.worstCase;
        }
        return total;
      },
      findReservation: async (p, key) =>
        [...s().reservations.values()].find((r) => r.projectId === p && r.idempotencyKey === key) ?? null,
      getReservation: async (id) => s().reservations.get(id) ?? null,
      insertReservation: async (r) => {
        const full: Reservation = {
          ...r, id: `res_${++this.nextId}`, status: 'held', observed: null, result: null, failed: false,
        };
        s().reservations.set(full.id, full);
        return { ...full };
      },
      reopenReservation: async (id, worstCase, month) => {
        Object.assign(res(id), { status: 'held', worstCase, month, observed: null, result: null, failed: false });
      },
      settleReservation: async (id, observed, result, failed) => {
        Object.assign(res(id), { status: 'settled', observed, result: result ?? null, failed });
      },
      releaseReservation: async (id) => { res(id).status = 'released'; },
      insertLedger: async (e) => { s().ledger.push({ ...e }); },
      insertApproval: async (a) => {
        const full: ApprovalRequest = { ...a, id: `apr_${++this.nextId}`, status: 'pending' };
        s().approvals.set(full.id, full);
        return { ...full };
      },
      getApproval: async (id) => {
        const a = s().approvals.get(id);
        return a ? { ...a } : null;
      },
      setApprovalStatus: async (id, status) => {
        const a = s().approvals.get(id);
        if (!a) throw new Error(`unknown approval ${id}`);
        a.status = status;
      },
      appendEvent: async (e) => { pending.push(e); },
    };
  }
}
