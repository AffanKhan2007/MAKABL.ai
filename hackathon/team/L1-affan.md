# L1 · Affan: demo laptop and integrator

You own the laptop the demo runs on, the `main` branch, and the pieces that tie everyone's
work together. If something is unclear about who decides, you decide.

## Your laptop

- The **only** machine the demo runs on. Keep its database clean; it is the demo database.
- No live builds here: model-written code runs on Nishant's laptop (L2), never on yours.
- Keep `npm run dev` and the public tunnel (#13) running from FREEZE onwards.

## What you own

| # | Item | Done when |
|---|---|---|
| 13 | Public URL: double-click **Public link.bat** (production build on port 3100 + `cloudflared` quick tunnel; link copied to the clipboard). Refuses to run if `.env.local` enables live builds. The link changes on every restart, so start it once at FREEZE and leave it | A link opens the app in a private window on a phone |
| 17 | Relay execution: spec → architect → build → review, each on its own model, passing a brief | **Done.** Ran live on Gemini; every phase and brief in the timeline |
| 18 | Token negotiator: per-phase budgets from the cap; a phase asks for more with a reason | **Done.** Grant, reassign, escalate and return, each recorded and shown in the timeline |
| 19 | Relay timeline UI on the project page | **Done.** Model per phase, spend against allowance, briefs, negotiator, reviews |
| — | Merging everyone's branches into `main` | `npm test` passes after every merge |

Already done this weekend: multi-vendor prices (57 models), what-if explorer, conflicts panel,
Easy mode and Pro mode.

## Things only you can do (do these first)

1. **GitHub:** repo → Settings → Collaborators → invite Nishant, Sanjana and Shuja.
2. **Commit and push** your current work so the other laptops (and the backup, below) get it.
3. **API keys**, each with a spending limit set on the provider's site:
   - Anthropic (console.anthropic.com), about $10 limit, for the live-build spike.
   - OpenAI and Google (Gemini): only needed if a relay phase runs live on them. The cost
     plan works without them.
4. Send Nishant what is listed under "What to send Nishant" in `L2-nishant.md`.

## Backup if your Claude limit runs out

Continue on Nishant's laptop, in Claude Code signed in with his Claude Pro (see `L2-nishant.md`,
"Taking over on this laptop"). Before switching: commit and push, and tell him in the group chat.
Pro has its own usage limit too, so save the big jobs for whichever laptop has headroom.

## Your day

| When (IST) | What |
|---|---|
| Sat 12:30–12:45 | Collaborator invites, push, send Nishant the key |
| Sat 12:45–15:53 | #13 tunnel up; start #17 relay execution |
| Sat 15:53–Sun 02:41 | #17 → #18 → #19; merge branches at every sync |
| Sun 02:41 | **Feature freeze.** Nothing new after this |
| Sun 02:45–06:15 | Sleep |
| Sun 06:15–07:29 | Clean-browser run of the demo path on the public link; fix only crashes |
| Sun 07:29–09:53 | Run the demo for Shuja's recording; final merge; check the submission |

Sync every two hours (13:00, 15:00, 17:00, 19:00, 21:00, 23:00, 01:00), ten minutes, you chair it.

## Rules you hold the team to

- Short branches, merged through you. No direct pushes to `main` from other laptops.
- No secrets in the repo: keys go in `.env.local`, which git ignores. The repo is public.
- Only claim live runs that happened (see the honesty rule in `plan.md`).
- Stuck 30 minutes on one thing: switch approach or cut it.
