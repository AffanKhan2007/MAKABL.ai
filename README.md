# MAKABL

Cost-planned, budget-gated AI builds for small web apps. Before an AI builds the app, MAKABL
shows a ranged cost plan (free path vs paid path) and enforces a spending cap, pausing to ask
before any paid action. See `docs/working-model-and-requirements.md` (the plan) and
`docs/research-critique.md` (the evidence behind it).

## Try the app

Requires Node 23.6+. From the project folder:

```bash
npm install
npm run db:local    # start Postgres 17 (no Docker needed); keeps running until db:local:stop
npm run db:reset    # create the app's tables (first time only; wipes the app's local data)
npm run dev         # then open http://localhost:3000
```

1. **New project**: describe the app and its features (the form is pre-filled with an example).
2. **Cost plan**: free vs paid path, each line with its range and confidence.
3. **Approve**: set the caps. Try a low cap (for example $1) to see the Budget Gate pause the build.
4. **Start build**: watch the live feed. When the Gate pauses it, approve a raise to resume.
   If the server stops mid-build, the page offers **Resume build**; finished steps replay free.

New projects build in **simulated** mode: a scripted stand-in plays the model, so no API
key is needed, nothing is spent, and simulated runs never feed the cost estimates. There
is no sign-in yet; everything belongs to one local development user, and every app query
runs as that user under row-level security.

### Live builds (real Claude, real money)

A live build has Claude write the app on a Next.js starter project, runs the type check,
tests and production build on it, and records each feature's real cost so estimates
improve. It is off until you turn it on:

1. Copy `.env.example` to `.env.local` and set `ANTHROPIC_API_KEY`.
2. Set `MAKABL_ALLOW_UNSANDBOXED_BUILDS=1`. Generated code (npm install, tests, next build)
   runs on this computer **without a sandbox**; only set this if you accept that.
3. Restart `npm run dev`. On a new project, before building, use **Switch to live build**
   and tick the confirmation. Keep the caps low for the first runs.

The API key stays in the server process; generated code runs with a stripped environment
and never sees it.

## Status

| Piece | File | State |
|---|---|---|
| Web app | `app/`, `src/server/` | Intake, cost plan, approvals, simulated and live builds, live feed, ledger. Every query runs as `makabl_app` under RLS |
| MVP schema (section 8) | `db/schema.sql`, `db/roles.sql` | Postgres 17, RLS on every tenant table including child tables |
| Pricing registry + seed | `src/registry/` | Verified against official pages on 2026-10-27; recheck by 2027-01-27, after which prices show as assumptions |
| Estimator (7.2, 7.3) | `src/estimator/estimator.ts` | Probe x logged ratios, P10/P50/P90 of logged runs (10+), or a cached agent-loop prior; Vercel usage from traffic; commercial-use gate; track record |
| Budget Gate (7.4) | `src/gate/` | Reserve then settle, task/project/monthly caps, idempotency keys, approvals with who decided, recovery of calls cut off by a restart |
| Claude adapter | `src/adapters/claude.ts` | Every call through the Gate; worst case includes a refusal fallback; each attempt priced at its own model. Not yet run against the live API |
| Build loop (P2) | `src/build/` | One agent per feature, confined workspace, platform checks, bounded retries, pause/resume by replay (tool log in Postgres), calibration run per feature |
| Starter template | `src/build/template.ts` | Next.js 16.4.3 + TypeScript + node:test; install, type check, tests and build verified to pass |

## Development

```bash
npm run db:reset:test   # create the tests' own database (makabl_test); first time only
npm test                # all suites; Postgres suites skip if makabl_test is missing
npm run typecheck
npm run build           # Next.js production build
npm run demo            # terminal walk-through of the cost plan and a forced pause
npm run db:up           # alternative: Postgres in Docker (needs Docker Desktop + WSL)
```

Tests never touch the app's database: they write calibration runs, and the app's
estimates must only learn from real builds.

### Postgres notes

- Row-level security does not apply to superusers or table owners. The app connects as
  the login role and switches to `makabl_app` per transaction (`src/db/scope.ts`).
- NOTIFY ignores RLS: every listener gets every project's events. The feed filters by
  project before anything reaches a browser.

## Next

1. Sign-in (an auth provider), replacing the single dev user in `src/server/session.ts`.
2. A real sandbox for generated code (container: no network or secrets, CPU/memory limits).
3. First live builds, then 10+ runs per feature type so estimates stop using priors.
4. User-approved acceptance criteria per feature (live builds use generic criteria now).
5. Integration checks and preview deploy to Vercel (gates G4, G5).
6. Check Supabase and GitHub commercial-use terms (only Vercel's were verified).

P0 (8 to 10 user interviews, with a commitment ask) is still open and is not a code task.
