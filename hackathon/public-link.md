> **Cut (1 Nov).** We chose not to open a public link: sign-up is open and builds run unsandboxed with API keys. The demo is a recorded video plus a local run. The notes below are kept only in case that decision is reversed.

# Public link for the judges (#13)

Goal: a `https` link judges can open, served from the demo laptop (L1) through a Cloudflare
quick tunnel. No account needed. The link changes every time the tunnel restarts.

## Read this first: what a public link exposes

Anyone with the link can **sign up and use the app**. So before opening the tunnel:

1. **Turn off live builds on L1.** In `.env.local` set `MAKABL_ALLOW_UNSANDBOXED_BUILDS=0`.
   With it off, nobody on the internet can make this laptop run model-written code.
2. **Take the API keys out of L1's `.env.local`** (or comment them out) while the tunnel is
   up. Otherwise a stranger could spend your Gemini or Anthropic quota through "Start build".
3. Restart `npm run dev` after changing `.env.local`.

With those off, the public demo still shows everything that does not need a live call: Easy
and Pro mode, the cost plan, the 57-model what-if explorer, the conflicts panel, the
spending-limit screens, and the relay timeline of any project that already ran. **Show the
live relay run from the recorded video**, or from Nishant's laptop, not from the public link.

## Steps (Windows, L1)

1. Install the tunnel tool once (about 40 MB):
   ```bash
   winget install --id Cloudflare.cloudflared
   ```
2. Start the database and the app (the usual way: `Launch MAKABL.bat`, or `npm run db:local`
   then `npm run dev`).
3. Seed the demo account (safe to repeat):
   ```bash
   npm run db:seed:demo
   ```
   Sign in as `demo@makabl.local` with password `demo-password-local`.
4. Open the tunnel in a second terminal:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
   It prints a line like `https://something-random.trycloudflare.com`. That is the link.
5. Open the link in a **private window on your phone** (mobile data, not the laptop's wifi)
   and click the whole demo path. If it opens, you are done.

## If something fails

| Symptom | Fix |
|---|---|
| The page loads but sign-in loops | Cookies need `https`; use the `trycloudflare.com` link, not `localhost` |
| "Cross-origin" or blocked dev resources | `*.trycloudflare.com` is already allowed in `next.config.ts`; restart `npm run dev` |
| Slow first load | `next dev` compiles on demand; click each page once before the judges do |
| The link stops working | The tunnel or laptop slept. Keep the laptop plugged in with sleep off, and keep the terminal open |

## Fallback

If the tunnel will not work: demo from L1 directly and say so, and show the recorded video.
Do not put the live app on a hosting service as-is: it keeps state in Postgres and runs
builds in the background, which serverless hosting does not allow.

When the demo is over: stop the tunnel (Ctrl+C), then restore the keys and
`MAKABL_ALLOW_UNSANDBOXED_BUILDS` in `.env.local` if you need them.
