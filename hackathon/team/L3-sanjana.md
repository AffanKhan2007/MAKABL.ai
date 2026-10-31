# L3 · Sanjana: product and design

You own how MAKABL looks and feels, and you are the voice of the person in **Easy mode**: a
restaurant owner who has never built an app. If they would hesitate on a screen, that screen
needs fixing.

## Set up your laptop

Same steps as everyone (Node 24 and git):

```bash
git clone https://github.com/AffanKhan2007/MAKABL.ai.git
cd MAKABL.ai
npm install
npm run db:local
npm run db:reset
npm run db:seed
npm run dev
```

Work on a branch (`git checkout -b design/<topic>`) and ask Affan to merge it.

## The two modes (your main area)

- **Easy mode** (the default): plain questions, tick boxes, three choices (Budget, Balanced,
  Best quality), "about $X to build, about $Y a month to run", and a short "Good to know" list.
- **Pro mode**: every model for every phase, tokens, retries, caching, conflicts and the full
  cost plan.
- The switch is in the top bar. Each browser remembers its choice.

## What you own

| # | Item | Done when |
|---|---|---|
| — | **Easy-mode walkthrough as a restaurant owner**: new project → price → choose → set limit → build | Every word on the way makes sense without explanation; list fixes and make them |
| 4 | **Demo seed**: one demo account, one finished project, one fresh idea ready to plan | Affan can run the demo from a clean database in under a minute |
| 19 | Design the relay timeline with Affan (model per phase, tokens against budget, briefs) | A sketch Affan agrees with by Sat 18:00 |
| — | First-screen and mobile polish | Landing page, Easy intake and project page look right on a phone |
| — | Screenshots for Shuja's deck | Easy price screen, Pro explorer, a conflict, the relay timeline |

## Checklist for the Easy-mode pass

- [ ] Would the owner understand every heading and button without help?
- [ ] Are there any technical words left (token, API, cap, relay, model)? Replace them in Easy mode
- [ ] Is the price obvious within five seconds of the page opening?
- [ ] Is "Nothing is charged until you say so" visible before any button that costs money?
- [ ] On a phone, does the whole flow work with one thumb?

## Your day

| When (IST) | What |
|---|---|
| Sat 12:30–12:45 | Laptop setup |
| Sat 12:45–15:53 | Easy-mode walkthrough and fixes |
| Sat 15:53–18:00 | Relay timeline sketch with Affan; demo seed (#4) |
| Sat 18:00–22:30 | Polish and mobile; screenshots for the deck |
| Sat 22:30–Sun 02:00 | Sleep |
| Sun 02:00–02:41 | Last design merges before the freeze |
| Sun 06:15–07:29 | Clean-browser run with Affan; note anything broken, fix only crashes |

## Rules

- Easy mode never shows a number without saying what it is for.
- Don't hide costs to make a screen simpler. Fewer words, same truth.
- After the freeze (Sun 02:41), no new screens; copy and spacing fixes only.
