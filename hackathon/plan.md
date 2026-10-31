# MAKABL — 24h hackathon plan

Clock: Sat 31 Oct 11:05 → Sun 1 Nov 11:05 (IST, UTC+05:30). Feature freeze Sun 02:41.
Submit by Sun 09:53. Track with `py -I <skill>/scripts/hack.py status` (state in `hackathon/state.json`).

## Pitch (one sentence)

For freelancers and small teams building web apps with AI, MAKABL shows what the build and
the first months will cost **before** anything is built, then builds it under a hard cap and
pauses to ask before going over.

## Rules

Prior work is **allowed if disclosed** (confirmed). We disclose it in one line of the written
submission only, never on stage (`hackathon/DISCLOSURE.md`, git tag `pre-hackathon`). The
weekend's headline work is what the demo shows:

1. **A real live build** (#1): Claude building a real feature, under the cap, on screen or
   recorded. Before the event it had never run.
2. **A public link** (#13) judges can open.
3. **The first screen** (#3) and the story (#5, #6).

## Rubric

_Not yet received. Paste the official criteria here verbatim._ Until then we assume: working
demo, clear problem, why it is new, believable path beyond the weekend.

Rubric fit (to re-check once the real criteria arrive):
- **Problem / impact:** AI build costs are unpredictable; budgets get blown (research doc).
- **Novelty:** no tool found that forecasts a whole build across vendors with ranges and
  enforces a cap before each charge.
- **Technical:** reserve-and-settle Budget Gate, row-level security, resumable builds,
  verification report that states what was *not* checked.

## Demo path (90 seconds, 7 steps)

1. Signed in; open **New project**, the inventory-tracker idea is ready. *(5s)*
2. **Get the cost plan**: free path blocked for client work, paid path as a range, unpriced
   items listed, every line with confidence. **Wow #1.** *(20s)*
3. Approve with a **$1 cap**. *(5s)*
4. **Start build**: the live feed fills as features build and pass checks. *(15s)*
5. The **Budget Gate pauses** before the cap would be crossed, with the approval card.
   **Wow #2.** *(15s)*
6. Approve a raise; it resumes and finishes: estimate vs actual per feature, and the
   verification report listing what was *not* checked. *(20s)*
7. Close: one line on calibration, real runs make the ranges tighter. *(10s)*

Honesty rule: simulated builds are labelled on screen. A live (real Claude) build is shown
only if the spike succeeds, and its cost is real.

## Team: 4 people, 4 laptops (no VM)

| Laptop | Owner role | Owns |
|---|---|---|
| **L1 Demo + integration** | Integrator | The `master` branch, the demo database, the public URL (#13), merges. The only machine the demo runs on. |
| **L2 Build machine** | Live-build owner | The live-build spike (#1), then #14, #8, #9. Live builds run here, so model-written code never runs on the demo laptop. Use the laptop with the least personal data on it. |
| **L3 Product + design** | UI owner | Hero first screen (#3), demo seed data (#4), first-screen polish in HARDEN. |
| **L4 Story** | Demo + pitch owner | Rubric and rules, demo script (#5), deck and pitch (#6), Q&A sheet, the fallback video. Starts now, not at hour 20. |

Rules: everyone works on a short branch and merges to `master` through L1. Ten-minute sync
every two hours (13:00, 15:00, 17:00, 19:00, 21:00, 23:00, 01:00). A laptop is not a sandbox:
say so if a judge asks.

## Riskiest unknowns (the spike, Sat 12:45 → 15:53)

1. **A live build has never run** (L2). Does Claude, through our loop, actually build a
   feature that passes type check, tests and build, within a few dollars? (#1)
2. **Public URL** (L1). The app is stateful (Postgres, background builds, live feed), so it
   cannot go on Vercel serverless as is. Plan: a Cloudflare quick tunnel from L1 to
   `localhost:3000`, which needs no account and gives a public `https` link. (#13)

If #1 fails or costs too much: demo the simulated build (labelled), show the live-build code
path and one recorded real run. If #13 fails: demo from L1, say so, keep the video.

## Schedule

| When (IST) | Phase | Work |
|---|---|---|
| Sat 11:05–12:45 | FRAME | All: clone repo + set up all 4 laptops. L4: rubric + rules. L2: API key with a spending limit. |
| Sat 12:45–15:53 | SPIKE | L2: #1 live build. L1: #13 public URL. L3: #3 hero draft. L4: deck outline. |
| Sat 15:53–Sun 02:41 | BUILD | L3: #3, #4. L2: #14, #8, #9. L1: integrate + keep URL up. L4: script, deck, Q&A. |
| Sun 02:41 | **FREEZE** | No new features after this |
| Sun 02:45–06:15 | SLEEP | Two at a time: L2+L3 sleep 22:30–02:00, L1+L4 sleep 02:45–06:15. |
| Sun 06:15–07:29 | HARDEN | Clean-browser run of the demo path, fix, fallback video |
| Sun 07:29–09:53 | DEMO+SUBMIT | #5 script + video, #6 pitch + Q&A, README, submit early |
| Sun 09:53–11:05 | BUFFER | Nothing new |

## Setting up each laptop (first 45 minutes, all four)

Needs Node 23.6+ and git. Get the repo onto each laptop: push it to a private GitHub repo
from L1 and clone it, or copy the folder over (the `node_modules` and `.pgdata` folders
are not needed). Then, on each laptop:

```bash
npm install
npm run db:local
npm run db:reset
npm run db:reset:test
npm run db:seed
npm test
npm run dev
```

Each laptop gets its own local database. Only L1's database is the demo.

## Cut list (honest "what's next")

- A real sandbox for generated code (container on a VM or cloud), Vercel deploys of the
  generated app, email verification / password reset, probe-then-quote in the UI. On the
  roadmap slide, not in the build.
