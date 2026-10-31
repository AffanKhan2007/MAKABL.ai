# L2 · Nishant: live-build machine and backup laptop

Two jobs. First, real AI builds run on your laptop, so model-written code never runs on the
demo laptop. Second, your laptop is Affan's backup: if Affan's Claude limit runs out, Affan
carries on here in Claude Code with your Claude Pro.

## Set up your laptop (first 45 minutes)

Needs Node 24 and git. Use the laptop with the least personal data on it, because live builds
run generated code without a sandbox.

```bash
git clone https://github.com/AffanKhan2007/MAKABL.ai.git
cd MAKABL.ai
npm install
npm run db:local
npm run db:reset
npm run db:reset:test
npm run db:seed
npm test
npm run dev
```

Open http://localhost:3000, sign up with any test email, and click through a project in Easy
and in Pro mode so you know the app.

## What you own

| # | Item | Done when |
|---|---|---|
| 1 | **Live-build spike:** one real feature built by Claude through MAKABL, under a $2 cap | Type check, tests and build pass; the real cost shows in the ledger |
| 14 | This laptop as the build machine: same repo, own database, live builds run here | Affan can ask for a live run and get a result the same day |

How to run the spike:

1. Put the key Affan sends you in `.env.local` (create the file in the repo folder):
   ```
   ANTHROPIC_API_KEY=<the key Affan sent>
   MAKABL_ALLOW_UNSANDBOXED_BUILDS=1
   ```
2. Restart `npm run dev`.
3. Pro mode → new project with **one** small feature (a page). Build model: Claude Sonnet 5.5.
   Approve with a **$2** cap.
4. Build mode card → switch to live, tick the box, start the build.
5. Screenshot the feed, the ledger and the verification report, and post them in the group chat.
   If it fails, post the error, not a summary of it.

The build model must be a Claude model: only the Claude adapter builds live today. The app
refuses others with a clear message.

## Claude Pro: what it does and does not cover

- **It covers Claude Code** (and claude.ai) when you are signed in with your account. That is
  what makes your laptop Affan's backup.
- **It does not cover MAKABL's live builds.** Those call the Claude API, which bills separately
  through console.anthropic.com. That is why you still need the API key from Affan.
- Pro has a usage limit that resets every few hours. If you both hit limits, tell the group.

## Taking over on this laptop (if Affan's limit runs out)

1. Affan commits and pushes, then tells you.
2. You run `git pull` in the repo folder.
3. Install Claude Code if you have not yet (code.claude.com), open a terminal in the repo folder,
   run `claude`, and sign in with your Claude Pro account.
4. Affan types this as the first message:
   > Read hackathon/plan.md, hackathon/team/L1-affan.md and `git log -10`. Run
   > `py -I <hackathon skill>/scripts/hack.py status` if available. Continue the open must items.
   > Don't commit until I say so.
5. When Affan has limit again, commit and push here, then Affan pulls on their own laptop.

## What to send Nishant (Affan's checklist)

- [ ] GitHub collaborator invite to the repo
- [ ] The Anthropic API key, with a ~$10 spending limit set at console.anthropic.com. Send it
      in a direct message, never in the group chat, the repo or a screenshot
- [ ] OpenAI / Gemini keys, only if a relay phase will run live on them
- [ ] A push of the latest `main`
- [ ] Nothing else is needed: no accounts, no paid tools. The database runs locally

## Your day

| When (IST) | What |
|---|---|
| Sat 12:30–12:45 | Laptop setup, tests pass |
| Sat 12:45–15:53 | #1 live-build spike |
| Sat 15:53–22:30 | #14; help Affan with #17 relay testing; live runs on request |
| Sat 22:30–Sun 02:00 | Sleep |
| Sun 02:00–02:41 | Last live run before the freeze, if one is needed |
| Sun 06:15–09:53 | On call for a re-run; keep the laptop on and charged |

## Rules

- Never commit `.env.local` or paste a key anywhere public. The repo is public.
- Live builds spend real money. Keep the cap at $2 per run unless Affan says otherwise.
- If a judge asks: this laptop is a dedicated build machine, not a sandbox. Say so plainly.
