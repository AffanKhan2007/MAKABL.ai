import type pg from 'pg';
import type { Micros } from '../domain/types.ts';
import type {
  ApprovalRequest, Budget, GateStore, GateTx, LedgerEntry, Reservation,
} from '../gate/store.ts';
import { fromNumeric, toNumeric } from './money.ts';
import { withTx, type DbScope } from './scope.ts';

// Postgres GateStore. Each withProject() is one transaction holding a transaction-scoped
// advisory lock on the project id, so check-and-reserve is serialised per project across
// every process sharing the database. (A row lock on budgets would not cover the first
// setBudget, when the row does not exist yet.) Events are inserted in the same
// transaction; the activity_events trigger NOTIFYs on commit only.

/**
 * userId sets app.user_id so row-level security applies; role switches to a non-owner
 * role (makabl_app) for each transaction, without which a superuser connection bypasses
 * RLS regardless.
 */
export type PgGateStoreOptions = DbScope;

type Q = Pick<pg.PoolClient, 'query'>;

interface ReservationRow {
  id: string; project_id: string; task_id: string; idempotency_key: string;
  worst_case: string; observed: string | null; status: Reservation['status'];
  month: string; result: unknown; failed: boolean;
}

interface ApprovalRow {
  id: string; project_id: string; kind: ApprovalRequest['kind'];
  status: ApprovalRequest['status']; request: StoredApproval;
}

/** Shape of approvals.request. Money stays in integer micros, with the currency named. */
interface StoredApproval {
  reason: string;
  blockedTaskId: string | null;
  costRangeMicros: { low: Micros; high: Micros };
  currency: 'USD';
  alternatives: string[];
  whoBills: string;
  cancellable: string;
  consequenceOfDeclining: string;
}

const toReservation = (r: ReservationRow): Reservation => ({
  id: r.id,
  projectId: r.project_id,
  taskId: r.task_id,
  idempotencyKey: r.idempotency_key,
  worstCase: fromNumeric(r.worst_case),
  observed: r.observed === null ? null : fromNumeric(r.observed),
  status: r.status,
  month: r.month,
  result: r.result,
  failed: r.failed,
});

const toApproval = (r: ApprovalRow): ApprovalRequest => ({
  id: r.id,
  projectId: r.project_id,
  kind: r.kind,
  status: r.status,
  reason: r.request.reason,
  blockedTaskId: r.request.blockedTaskId,
  costRange: r.request.costRangeMicros,
  alternatives: r.request.alternatives,
  whoBills: r.request.whoBills,
  cancellable: r.request.cancellable,
  consequenceOfDeclining: r.request.consequenceOfDeclining,
});

export class PgGateStore implements GateStore {
  private readonly pool: pg.Pool;
  private readonly scope: DbScope;

  constructor(pool: pg.Pool, opts: PgGateStoreOptions = {}) {
    this.pool = pool;
    this.scope = opts;
  }

  withProject<T>(projectId: string, fn: (tx: GateTx) => Promise<T>): Promise<T> {
    return this.transaction(async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [projectId]);
      return fn(this.tx(c));
    });
  }

  spent(projectId: string): Promise<Micros> {
    return this.transaction(async (c) => {
      const { rows } = await c.query<{ total: string | null }>(
        `select sum(amount) as total from cost_ledger_entries
          where project_id = $1 and ledger = 'customer'`,
        [projectId],
      );
      return fromNumeric(rows[0]?.total ?? null);
    });
  }

  ledger(projectId: string): Promise<LedgerEntry[]> {
    return this.transaction(async (c) => {
      const { rows } = await c.query<{
        project_id: string; task_id: string; reservation_id: string; amount: string;
        basis: LedgerEntry['basis']; description: string;
      }>(
        `select project_id, task_id, reservation_id, amount, basis, description
           from cost_ledger_entries where project_id = $1 and ledger = 'customer'
          order by created_at, id`,
        [projectId],
      );
      return rows.map((r) => ({
        projectId: r.project_id, taskId: r.task_id, reservationId: r.reservation_id,
        amount: fromNumeric(r.amount), basis: r.basis, description: r.description,
      }));
    });
  }

  pendingApprovals(projectId: string): Promise<ApprovalRequest[]> {
    return this.transaction(async (c) => {
      const { rows } = await c.query<ApprovalRow>(
        `select id, project_id, kind, status, request from approvals
          where project_id = $1 and status = 'pending' order by created_at`,
        [projectId],
      );
      return rows.map(toApproval);
    });
  }

  private transaction<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    return withTx(this.pool, this.scope, fn);
  }

  private tx(c: Q): GateTx {
    const one = async <R extends pg.QueryResultRow>(sql: string, params: unknown[]) =>
      (await c.query<R>(sql, params)).rows[0] ?? null;
    const resCols = 'id, project_id, task_id, idempotency_key, worst_case, observed, status, month, result, failed';
    const mustUpdate = async (sql: string, params: unknown[], what: string) => {
      const { rowCount } = await c.query(sql, params);
      if (rowCount !== 1) throw new Error(`${what}: expected 1 row, updated ${rowCount}`);
    };

    return {
      getBudget: async (projectId) => {
        const r = await one<{ project_cap: string; monthly_cap: string }>(
          'select project_cap, monthly_cap from budgets where project_id = $1', [projectId]);
        return r ? { projectCap: fromNumeric(r.project_cap), monthlyCap: fromNumeric(r.monthly_cap) } : null;
      },

      setBudget: async (projectId, b: Budget) => {
        await c.query(
          `insert into budgets (project_id, project_cap, monthly_cap) values ($1, $2, $3)
           on conflict (project_id) do update
             set project_cap = excluded.project_cap, monthly_cap = excluded.monthly_cap, updated_at = now()`,
          [projectId, toNumeric(b.projectCap), toNumeric(b.monthlyCap)],
        );
      },

      committed: async (projectId, f) => {
        const r = await one<{ total: string | null }>(
          `select sum(case when status = 'settled' then observed else worst_case end) as total
             from reservations
            where project_id = $1 and status <> 'released'
              and ($2::text is null or task_id = $2)
              and ($3::text is null or month = $3)`,
          [projectId, f.taskId ?? null, f.month ?? null],
        );
        return fromNumeric(r?.total ?? null);
      },

      findReservation: async (projectId, key) => {
        const r = await one<ReservationRow>(
          `select ${resCols} from reservations where project_id = $1 and idempotency_key = $2`,
          [projectId, key]);
        return r && toReservation(r);
      },

      heldReservations: async (projectId) => {
        const { rows } = await c.query<ReservationRow>(
          `select ${resCols} from reservations where project_id = $1 and status = 'held' order by created_at`,
          [projectId]);
        return rows.map(toReservation);
      },

      getReservation: async (id) => {
        const r = await one<ReservationRow>(`select ${resCols} from reservations where id = $1`, [id]);
        return r && toReservation(r);
      },

      insertReservation: async (r) => {
        const row = await one<ReservationRow>(
          `insert into reservations (project_id, task_id, idempotency_key, worst_case, currency, month)
           values ($1, $2, $3, $4, 'USD', $5) returning ${resCols}`,
          [r.projectId, r.taskId, r.idempotencyKey, toNumeric(r.worstCase), r.month]);
        return toReservation(row!);
      },

      reopenReservation: (id, worstCase, month) => mustUpdate(
        `update reservations set status = 'held', worst_case = $2, month = $3,
                observed = null, result = null, failed = false, settled_at = null, created_at = now()
          where id = $1 and status = 'released'`,
        [id, toNumeric(worstCase), month], `reopen ${id}`),

      settleReservation: (id, observed, result, failed) => mustUpdate(
        `update reservations set status = 'settled', observed = $2, result = $3, failed = $4, settled_at = now()
          where id = $1 and status = 'held'`,
        [id, toNumeric(observed), JSON.stringify(result ?? null), failed], `settle ${id}`),

      releaseReservation: (id) => mustUpdate(
        `update reservations set status = 'released' where id = $1 and status = 'held'`,
        [id], `release ${id}`),

      insertLedger: async (e) => {
        await c.query(
          `insert into cost_ledger_entries
             (ledger, project_id, task_id, reservation_id, amount, currency, basis, description)
           values ('customer', $1, $2, $3, $4, 'USD', $5, $6)`,
          [e.projectId, e.taskId, e.reservationId, toNumeric(e.amount), e.basis, e.description]);
      },

      insertApproval: async (a) => {
        const request: StoredApproval = {
          reason: a.reason, blockedTaskId: a.blockedTaskId, costRangeMicros: a.costRange,
          currency: 'USD', alternatives: a.alternatives, whoBills: a.whoBills,
          cancellable: a.cancellable, consequenceOfDeclining: a.consequenceOfDeclining,
        };
        const row = await one<ApprovalRow>(
          `insert into approvals (project_id, kind, request) values ($1, $2, $3)
           returning id, project_id, kind, status, request`,
          [a.projectId, a.kind, JSON.stringify(request)]);
        return toApproval(row!);
      },

      getApproval: async (id) => {
        const r = await one<ApprovalRow>(
          'select id, project_id, kind, status, request from approvals where id = $1', [id]);
        return r && toApproval(r);
      },

      setApprovalStatus: (id, status, decidedBy) => mustUpdate(
        `update approvals set status = $2, decided_by = $3, decided_at = now() where id = $1`,
        [id, status, decidedBy], `approval ${id}`),

      appendEvent: async (e) => {
        await c.query(
          `insert into activity_events (project_id, task_id, type, payload, annotation)
           values ($1, $2, $3, $4, $5)`,
          [e.projectId, e.taskId, e.type, JSON.stringify(e.payload), e.annotation ?? null]);
      },
    };
  }
}
