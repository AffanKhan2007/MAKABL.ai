# MAKABL

Cost-planned, budget-gated AI builds for small web apps. Before an AI builds the app, MAKABL
shows a ranged cost plan (free path vs paid path) and enforces a spending cap, pausing to ask
before any paid action. See `docs/working-model-and-requirements.md` (the plan) and
`docs/research-critique.md` (the evidence behind it).

## Status: P1 core (cost engine + Budget Gate on Postgres)

| Piece | File | State |
|---|---|---|
| MVP schema (section 8) | `db/schema.sql`, `db/roles.sql` | Applied and tested on Postgres 17, including row-level security |
| Pricing registry + seed | `src/registry/` | Verified against official pages on 2026-10-27; recheck by 2027-01-27, after which prices show as assumptions. Includes cache write/read rates and Haiku 5.5's long-prompt tier |
| Estimator (7.2, 7.3) | `src/estimator/estimator.ts` | Build cost from, best first: probe x logged full/probe ratios, P10/P50/P90 of logged runs (10+), or a cached agent-loop prior. Vercel usage from expected traffic. Commercial-use gate, unpriced bucket, published track record |
| Calibration runs | `src/calibration/runs.ts`, `src/db/pg-run-log.ts` | Every real build's tokens and booked cost, append-only, pooled across tenants |
| Claude adapter | `src/adapters/claude.ts` | All model calls go through the Budget Gate; counts tokens, reserves the worst case (incl. a refusal fallback), prices each attempt at its own model. Not yet run against the live API |
| Build loop (P2) | `src/build/` | One agent per feature with file tools on a confined workspace; platform-defined checks; bounded retries by count and cost; pause on budget block and resume by replay; logs a calibration run per feature. Tested only against a scripted fake model |
| Budget Gate (7.4) | `src/gate/budget-gate.ts` | Reserve then settle, task/project/monthly caps, idempotency keys, approvals |
| Gate storage | `src/gate/store.ts` | `MemoryGateStore` (tests, demo) and `PgGateStore` (one transaction + advisory lock per project) |
| Event log | `src/events/event-store.ts`, `src/db/pg-event-log.ts` | Append-only; Postgres feed via LISTEN/NOTIFY, fired on commit only |

## Run

Requires Node 23.6+ (runs TypeScript directly, no build step).

```bash
npm install
npm run db:up       # Postgres 17 in Docker on localhost:5433 (needs Docker Desktop + WSL)
npm run db:local    # or: the same Postgres 17 without Docker; runs detached until db:local:stop
npm run db:reset    # drop and re-apply db/schema.sql + db/roles.sql (local hosts only)
npm test            # gate suite on memory and Postgres, RLS, estimator
npm run typecheck
npm run demo        # cost plan, then a forced overrun that pauses for approval
npm run demo -- --pg
```

Postgres tests skip themselves when no database is reachable at `DATABASE_URL`
(default `postgres://postgres:makabl@localhost:5433/makabl`). The demo simulates model
calls; nothing is sent to a provider.

### Postgres notes

- Row-level security does not apply to superusers or table owners. The app must connect
  as (or `SET ROLE` to) `makabl_app` and construct `PgGateStore` with `{ userId }`.
- NOTIFY ignores RLS: every listener gets every project's events. Always subscribe with
  a `projectId` filter before forwarding to a browser.
- `agent_runs`, `artifact_versions`, `task_dependencies`, `usage_events` and `deployments`
  have no `project_id`, so they have no RLS policy yet.

## Next

1. Real sandbox for checks (container with no network or secrets, CPU/memory limits); the
   current workspace runs checks as local processes and is for development only.
2. Persist the tool log in Postgres so a build can resume after a process restart.
3. Calibration: 10+ real runs per feature type (with probes) so estimates stop using priors.
3. Next.js app: intake, cost plan screen, approval queue, SSE feed.
4. RLS for the child tables listed above; record `decided_by` on approvals.
4. Check Supabase and GitHub commercial-use terms (only Vercel's were verified).

P0 (8 to 10 user interviews, with a commitment ask) is still open and is not a code task.
