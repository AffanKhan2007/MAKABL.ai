# L4 · Shuja: story, demo and pitch

You own what the judges hear and see: the rubric, the demo script, the deck, the Q&A and the
submission. Start now, not at hour 20; the story shapes what the others finish first.

## Set up your laptop

You need the app running to write the script against it:

```bash
git clone https://github.com/AffanKhan2007/MAKABL.ai.git
cd MAKABL.ai
npm install
npm run db:local
npm run db:reset
npm run db:seed
npm run dev
```

## What you own

| # | Item | Done when |
|---|---|---|
| — | **Rubric**: paste the official judging criteria into `hackathon/plan.md` | Every demo step maps to a criterion |
| 5 | **Demo script (90 s)** and a fallback screen recording | Rehearsed aloud, timed, recording saved in two places |
| 6 | **Pitch and deck**: problem, demo, how it works, impact | Rehearsed twice, under time |
| — | **Q&A sheet**: the ten hardest questions with one-sentence answers | The team has read it |
| — | **Submission**: form, README, links, video | Submitted by Sun 09:53 |

## The story to tell

One sentence: *For anyone who wants an app built by AI, MAKABL says what it will cost before
it starts, builds it with the right AI for each step, and never spends past your limit
without asking.*

Demo shape (both modes in 90 seconds):

1. **Easy mode, the restaurant owner.** "I want table bookings." Tick boxes → about $X to build,
   about $Y a month to run. Pick Budget and watch the price drop. *(25 s)*
2. **Flip to Pro, the person who knows.** The same project as a relay of models: spec, architect,
   build, review, each on its own model from Anthropic, OpenAI or Google. Change a model and
   the price and the conflicts update instantly. *(25 s)*
3. **The catch is shown, not hidden.** A conflict: a model that doubles in price on 1 December,
   or free hosting ruled out for business use. *(15 s)*
4. **The limit holds.** The build pauses before it would go over the cap and asks. *(15 s)*
5. Close: estimate against actual, and what was checked. *(10 s)*

Update step 2 once Affan's relay timeline (#19) lands.

## Q&A answers to have ready

- **Is the relay real?** Say exactly what is real on the day. The cost plan prices every phase
  today; whether phases run live depends on #17. Never claim more than the demo shows.
- **How accurate are the estimates?** Ranges, not a bill. Wide on purpose until enough real
  builds are logged; the app says so on screen.
- **Where do the prices come from?** The vendors' official pricing pages, checked 31 Oct, with
  a re-check date; stale prices are flagged.
- **Is generated code sandboxed?** No: it runs on a dedicated team laptop. Say so plainly.
- **Was this built this weekend?** One sentence, the facts in `hackathon/DISCLOSURE.md`, then
  move on.

## Your day

| When (IST) | What |
|---|---|
| Sat 12:30–12:45 | Rubric and rules into `plan.md` |
| Sat 12:45–15:53 | Deck outline; first script draft |
| Sat 15:53–Sun 02:41 | Script, deck, Q&A; rehearse at the 19:00 and 23:00 syncs |
| Sun 02:45–06:15 | Sleep |
| Sun 06:15–07:29 | Record the fallback video from the public link |
| Sun 07:29–09:53 | Final rehearsal, README, submit **early** |
| Sun 09:53–11:05 | Buffer. Nothing new |

## Rules

- Problem first, then the demo, then how it works. Not the tech first.
- Anything simulated is called simulated on stage.
- The prior-work line goes in the submission form only (see `hackathon/DISCLOSURE.md`), not
  on stage or in the deck.
- Submit by 09:53. The portal will be slow at the end.
