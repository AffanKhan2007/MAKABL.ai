# MAKABL

**An economy of AI models that builds your web app and pays its own way, inside a budget you set.**

You describe an app. MAKABL plans what it will cost before anything is spent, then runs the
build as a **relay of AI models from different vendors**: a cheap model writes the spec, a
strong one designs, a builder writes and checks the code, and a reviewer reads the result.
Each model gets an **allowance carved from your cap**. When one needs more, a **token
negotiator** grants it from slack, moves spare budget from another phase, or escalates to the
**Budget Gate**, which stops and asks you before your cap could be crossed.

Built for the **auto-economy track**: agents with their own budgets, a market for who does
which job, and hard money controls a person can trust.

| Plain words | What it does |
|---|---|
| **Know the price first** | A ranged estimate for building (and running) the app, per phase and per model, across 57 models from Anthropic, OpenAI and Google, from their official price lists |
| **Right model for each job** | Spec, architect, build and review each run on their own model; a finishing model hands the next a short brief, not its whole history |
| **Models negotiate for tokens** | Per-phase allowances from the cap; grant, reassign or escalate, every decision on the record |
| **Never over budget** | Every call reserves its worst case first; the build pauses for approval before a cap could be crossed |
| **See the catch** | Conflicts and shortcomings beside the numbers: price rises, preview models, free tiers, cheap builders that retry more |
| **Two ways in** | **Easy mode** (plain words, three choices) and **Pro mode** (every model, phase, token and number) |

## What is real today

Honest status, as of 1 Nov 2026:

| Piece | State |
|---|---|
| Cost estimator: per phase, per model, ranges, free vs paid path, what-if explorer | Working. Ranges come from modelled priors until 10+ real runs per feature type are logged; the app says so |
| Relay execution: spec → architect → build → review with handoff briefs | **Ran end to end, live, on Gemini's free tier.** All four phases finished, with briefs (36%, 74% and 95% fewer tokens than the full history), negotiator decisions recorded in the event log, and a reviewer's verdict |
| Live view of the build | The generated app runs in a dev server while the models write it and is embedded on the project page (hot reload does the updating); it stops with the build. Verified on a real generated app; the embedded view itself has not yet been watched during a full build |
| Token negotiator | Working and tested; live run returned unspent allowance from the spec and architect phases |
| Budget Gate: reserve, settle, caps, approvals, replay after restart | Working and tested |
| Gemini adapter | Live-tested. Free-tier quotas are small (20 requests/day for Gemini 3.6 Flash), so a full build may need a paid key |
| Claude adapter | Implemented and tested with a fake transport; needs an Anthropic API key with credit for a live run |
| OpenAI / OpenRouter adapter | Implemented and tested with a mocked API; **not yet run live** (no key) |
| A generated app passing all checks end to end | **Yes, once:** a one-page cafe specials site passed its type check, its own tests and the production build on the first attempt, plus the whole-project checks. Cost $0.02 of a $2.00 cap (estimate: $0.11). The model also added a fake sign-in wall nobody asked for, and its reviewer, the same small model, approved it. One run is not a benchmark |
| Sandbox for generated code | None: it runs on the build machine. Do not run builds on a machine with personal data |

## Try it

Requires Node 23.6+ (Node 24 recommended) and git.

```bash
git clone https://github.com/AffanKhan2007/MAKABL.ai.git
cd MAKABL.ai
npm install
npm run db:local    # Postgres 17, no Docker needed
npm run db:reset    # create the tables (first time only; wipes local data)
npm run db:seed     # optional: a local development account
npm run dev         # open http://localhost:3000
```

On Windows, double-click **Launch MAKABL.bat**: it starts the database, creates the tables
if they are missing (without wiping data) and opens the app.

Without any API key you can use everything except a live build: Easy and Pro modes, the cost
plan, the 57-model what-if explorer, the conflicts panel and the relay timeline's plan.

### Live builds

1. Copy `.env.example` to `.env.local` and set at least one key:
   - `GEMINI_API_KEY`: has a free tier (Google may use free-tier prompts to improve its products)
   - `ANTHROPIC_API_KEY`: Claude models
   - `OPENAI_API_KEY` or `OPENROUTER_API_KEY`: OpenAI models
2. Set `MAKABL_ALLOW_UNSANDBOXED_BUILDS=1`. Generated code (npm install, tests, next build)
   runs on this computer **without a sandbox**; only set it if you accept that.
3. Restart, create a project, set a low limit (for example $2), tick the confirmation, start.

A relay phase whose vendor has no key runs on the build model instead, and the timeline says
so. Keys stay in the server process; generated code runs with a scrubbed environment.

## How it works

```
idea ──► Estimator ──► plan (ranges, per phase, per model) ──► you approve a cap
                                                                    │
            ┌──────────────────────── Negotiator (allowance per phase, slack) ─┐
            ▼                                                                   │
  Spec model ──brief──► Architect model ──brief──► Builder (per feature) ──► Reviewer
      │                      │                          │  tools + checks       │
      └──────────────────────┴──────── every call ──────┴───────────────────────┘
                                         ▼
                         Budget Gate: reserve worst case → call → settle
                         (pauses for approval before a cap is crossed)
```

| Part | Where |
|---|---|
| Pricing registry: 57 models + hosting, database, git | `src/registry/models.ts`, `src/registry/seed.ts` |
| Estimator and conflicts | `src/estimator/estimator.ts`, `src/estimator/conflicts.ts` |
| Relay and negotiator | `src/relay/relay.ts`, `src/relay/negotiator.ts`, orchestration in `src/server/builds.ts` |
| Budget Gate | `src/gate/` |
| Provider adapters | `src/adapters/claude.ts`, `gemini.ts`, `openai.ts` |
| Build loop: tools, confined workspace, checks, retries | `src/build/` |
| Web app: Easy/Pro, what-if, timeline, feed | `app/` |
| Schema with row-level security | `db/schema.sql`, `db/roles.sql` |

Design documents: `docs/working-model-and-requirements.md` (the plan) and
`docs/research-critique.md` (the evidence). OpenRouter design: `hackathon/openrouter.md`.

## Development

```bash
npm run db:reset:test   # the tests' own database (makabl_test), first time only
npm test                # 147 tests; none call a real API
npm run typecheck
npm run build
```

Tests never touch the app's database, so test runs never train the estimator. Databases are
created as UTF-8 (on Windows, Postgres otherwise defaults to WIN1252 and rejects characters
that models and test runners print).

### Postgres notes

- Row-level security does not apply to superusers or table owners. The app connects as the
  login role and switches to `makabl_app` per transaction (`src/db/scope.ts`).
- NOTIFY ignores RLS: every listener gets every project's events. The feed filters by
  project before anything reaches a browser.

## Next

1. A real sandbox for generated code (container: no network or secrets, CPU/memory limits).
2. Paid-key live runs on every vendor, then 10+ runs per feature type so estimates stop using priors.
3. Models that ask the negotiator themselves, through a tool, with their own reason.
4. Preview and production deploys with approval.
5. Email verification and password reset.

Team: Affan, Nishant, Sanjana, Shuja.

## License

MIT, see `LICENSE`.
