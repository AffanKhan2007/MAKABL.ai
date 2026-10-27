import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { usd } from '../src/domain/types.ts';
import { BudgetBlockedError, FailedAttemptReplayError, type PaidCallRequest } from '../src/gate/budget-gate.ts';
import { memoryEnv, pgEnv, type GateEnv } from './support/envs.ts';

// One behavioural suite, run against every store. The Postgres run needs a database with
// db/schema.sql applied (npm run db:up, then npm run db:reset); it is skipped otherwise.

const envs: Array<{ name: string; make: () => Promise<GateEnv | null> }> = [
  { name: 'memory', make: async () => memoryEnv() },
  { name: 'postgres', make: pgEnv },
];

for (const { name, make } of envs) {
  const env = await make();
  describe(`BudgetGate (${name})`, { skip: env ? false : 'no database at DATABASE_URL' }, () => {
    if (!env) return;
    const { gate, events } = env;
    after(() => env.close());

    let n = 0;
    const req = (projectId: string, over: Partial<PaidCallRequest> = {}): PaidCallRequest => ({
      projectId, taskId: 't_1', taskCeiling: usd(10), idempotencyKey: `k_${++n}`,
      worstCase: usd(0.4), description: 'model call', ...over,
    });
    const project = async (projectCap = usd(1), monthlyCap = usd(1)) => {
      const p = await env.newProject();
      await gate.setBudget(p, { projectCap, monthlyCap });
      return p;
    };

    test('reserves, settles to observed cost, and records a usage_observed ledger entry', async () => {
      const P = await project();
      const out = await gate.execute(req(P), async () => ({ result: 'ok', observed: usd(0.15) }));
      assert.equal(out, 'ok');
      assert.equal(await gate.spent(P), usd(0.15));
      assert.equal((await gate.ledgerFor(P))[0]?.basis, 'usage_observed');
    });

    test('blocks before calling the provider when the project cap would be exceeded', async () => {
      const P = await project(usd(0.5));
      let called = false;
      await assert.rejects(
        gate.execute(req(P, { worstCase: usd(0.6) }), async () => { called = true; return { result: 1, observed: 0 }; }),
        BudgetBlockedError,
      );
      assert.equal(called, false);
      assert.equal(await gate.spent(P), 0);
      const types = (await events.list(P)).map((e) => e.type);
      assert.ok(types.includes('budget_blocked'));
      assert.ok(types.includes('task_paused'));
      const [approval] = await gate.pendingApprovals(P);
      assert.equal(approval?.kind, 'budget_raise');
      // FR-14: every field present
      for (const f of ['reason', 'blockedTaskId', 'costRange', 'alternatives', 'whoBills', 'cancellable', 'consequenceOfDeclining']) {
        assert.ok(approval && (approval as unknown as Record<string, unknown>)[f] !== undefined, f);
      }
      assert.equal(approval?.costRange.high, usd(0.6));
    });

    test('enforces the per-task ceiling independently of the project cap', async () => {
      const P = await project(usd(100), usd(100));
      await gate.execute(req(P, { taskCeiling: usd(0.5) }), async () => ({ result: 1, observed: usd(0.3) }));
      const r = await gate.authorize(req(P, { taskCeiling: usd(0.5), worstCase: usd(0.3) }));
      assert.equal(r.ok, false);
      assert.match(!r.ok ? r.reason : '', /task ceiling/);
    });

    test('concurrent calls cannot jointly exceed the cap', async () => {
      const P = await project(usd(1));
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          gate.execute(req(P, { worstCase: usd(0.3) }), async () => {
            await new Promise((r) => setTimeout(r, 5));
            return { result: 1, observed: usd(0.3) };
          })),
      );
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3);
      assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason instanceof BudgetBlockedError));
      assert.equal(await gate.spent(P), usd(0.9));
    });

    test('a resumed step with the same idempotency key does not pay twice', async () => {
      const P = await project();
      let calls = 0;
      const call = async () => { calls++; return { result: { files: ['a.ts'] }, observed: usd(0.2) }; };
      const r = req(P, { idempotencyKey: 't_1:attempt_1' });
      await gate.execute(r, call);
      const replay = await gate.execute(r, call);
      assert.deepEqual(replay, { files: ['a.ts'] });
      assert.equal(calls, 1);
      assert.equal(await gate.spent(P), usd(0.2));
      assert.ok((await events.list(P)).some((e) => e.type === 'idempotent_replay'));
    });

    test('a key whose reservation is still held is refused, not called twice', async () => {
      const P = await project();
      const first = await gate.authorize(req(P, { idempotencyKey: 'k_inflight' }));
      assert.equal(first.ok, true);
      await assert.rejects(gate.authorize(req(P, { idempotencyKey: 'k_inflight' })), /still in flight/);
    });

    test('a released reservation frees its budget and its key can be reused', async () => {
      const P = await project(usd(0.5));
      const first = await gate.authorize(req(P, { idempotencyKey: 'k_release', worstCase: usd(0.4) }));
      assert.ok(first.ok && 'token' in first);
      await gate.release(first.token);
      const again = await gate.authorize(req(P, { idempotencyKey: 'k_release', worstCase: usd(0.4) }));
      assert.ok(again.ok && 'token' in again);
      assert.equal(again.token.reservationId, first.token.reservationId);
    });

    test('a failed call books the worst case as estimated instead of dropping it', async () => {
      const P = await project();
      await assert.rejects(gate.execute(req(P, { worstCase: usd(0.4) }), async () => { throw new Error('timeout'); }));
      const [entry] = await gate.ledgerFor(P);
      assert.equal(entry?.amount, usd(0.4));
      assert.equal(entry?.basis, 'estimated');
    });

    test('a key whose call failed cannot replay; a retry must use a new key', async () => {
      const P = await project();
      const r = req(P, { idempotencyKey: 'k_failed' });
      await assert.rejects(gate.execute(r, async () => { throw new Error('reset'); }), /reset/);
      let called = false;
      await assert.rejects(
        gate.execute(r, async () => { called = true; return { result: 1, observed: 0 }; }),
        FailedAttemptReplayError,
      );
      assert.equal(called, false);
      assert.equal(await gate.execute(req(P, { idempotencyKey: 'k_failed:retry' }), async () => ({ result: 'ok', observed: 0 })), 'ok');
    });

    test('approving a budget raise lets the paused task proceed', async () => {
      const P = await project(usd(0.5));
      const blocked = await gate.authorize(req(P, { worstCase: usd(0.6) }));
      assert.equal(blocked.ok, false);
      if (blocked.ok) return;
      await gate.decide(P, blocked.approval.id, 'approved', usd(0.5));
      assert.equal((await gate.getBudget(P)).projectCap, usd(1));
      assert.equal((await gate.authorize(req(P, { worstCase: usd(0.6) }))).ok, true);
      await assert.rejects(gate.decide(P, blocked.approval.id, 'declined'), /already approved/);
    });

    test('overshoot beyond the reservation is disclosed as an event', async () => {
      const P = await project();
      await gate.execute(req(P, { worstCase: usd(0.1) }), async () => ({ result: 1, observed: usd(0.12) }));
      assert.ok((await events.list(P)).some((e) => e.type === 'budget_overshoot'));
    });

    test('paid resources need an approved request regardless of remaining budget', async () => {
      const P = await project(usd(1000), usd(1000));
      const draft = {
        kind: 'recurring_charge' as const, reason: 'Vercel Pro for production', blockedTaskId: null,
        costRange: { low: usd(20), high: usd(20) }, alternatives: ['Stay on preview only'],
        whoBills: 'Vercel, to your account', cancellable: 'Monthly', consequenceOfDeclining: 'No production deploy',
      };
      const first = await gate.requireDiscreteApproval(P, null, draft);
      assert.equal(first.approved, false);
      if (first.approved) return;
      await gate.decide(P, first.approval.id, 'approved');
      assert.deepEqual(await gate.requireDiscreteApproval(P, first.approval.id, draft), { approved: true });
    });

    test('a failure inside a transaction rolls back its writes and events', async () => {
      const P = await project();
      const fake = { reservationId: 'res_missing', projectId: P, taskId: 't_1', worstCase: usd(0.1) };
      const before = (await events.list(P)).length;
      await assert.rejects(gate.settle(fake, usd(0.1), 'x'));
      assert.equal(await gate.spent(P), 0);
      assert.equal((await events.list(P)).length, before);
    });

    test('subscribers see committed events for their project only', async () => {
      const P = await project();
      const other = await project();
      const seen: string[] = [];
      const unsubscribe = await events.subscribe((e) => seen.push(`${e.projectId}:${e.type}`), { projectId: P });
      try {
        await gate.execute(req(P), async () => ({ result: 1, observed: usd(0.1) }));
        await gate.execute(req(other), async () => ({ result: 1, observed: usd(0.1) }));
        // NOTIFY is asynchronous; give it a moment to arrive.
        await new Promise((r) => setTimeout(r, 200));
      } finally {
        await unsubscribe();
      }
      assert.deepEqual(seen, [`${P}:budget_reserved`, `${P}:budget_settled`]);
    });
  });
}
