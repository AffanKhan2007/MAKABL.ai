# Demo script (90 seconds) and pitch order

Track: **auto-economy**. The one-line story: *AI models that work as a team with a budget:
each is paid for its own job, they ask for more when they need it, and a hard limit means
nobody can overspend.*

Everything below is real software. Where something has not run live, the script says so.

## Before you start (5 minutes, every time)

- `git pull`, `npm run dev`, database running.
- `npm run db:seed:demo`, then sign in as `demo@makabl.local` / `demo-password-local`.
- Set the theme you want on stage (☾ dark looks best on a projector).
- Have the **Cafe specials** project open in a second tab (the real relay run, on
  `dev@makabl.local`; or the recorded video if that account is not on this laptop).
- Phone on charge, the fallback video ready to play.

## The 90 seconds

| Time | Who | On screen | Say |
|---|---|---|---|
| 0:00 | Shuja | Slide 1 | "Building an app with AI has no price tag. You find out afterwards, and bills blow up. MAKABL gives you the price first and a limit it can't cross." |
| 0:10 | Sanjana | **Easy mode** → New project, "table bookings", tick the boxes | "A restaurant owner types what they want and ticks what it needs. No jargon." |
| 0:25 | Sanjana | Price screen: build cost, monthly cost, Budget / Balanced / Best | "About $X to build, about $Y a month to run. Pick Budget and the price drops. The limit is set before anything starts." |
| 0:40 | Affan | Flip to **Pro**, the Relay what-if panel | "Same project for someone who knows. The build is a relay of models, each doing one job: spec, architect, build, review. 57 models from three vendors, priced from their official lists." |
| 0:55 | Affan | Change a model; point at the conflicts list | "Change a model and the price and the catch update at once: this one doubles in price on 1 December, this one is a preview." |
| 1:10 | Affan | A running build shows **Live view** (the app taking shape) above the **Relay timeline**; otherwise open **Cafe specials v2** → Relay timeline | "This ran for real. The spec model wrote a brief; the architect worked from only that brief, 44% fewer tokens than the full history. Each phase has an allowance from the cap, and unspent money goes back to a shared pool. Every decision is on the record." |
| 1:25 | Nishant | The ledger and the paused state | "And the cap holds. It stopped when the provider's quota ran out, and booked nothing for calls that never ran." |
| 1:30 | Shuja | Last slide | "Next: models that ask for tokens themselves, and paid-key runs on every vendor." |

Order of speakers matters less than the rule: **one person drives the keyboard (Affan), the
others only talk.**

## If you get 3 minutes: the live evidence (all real projects on this laptop)

1. **Brew and Bean → Wireframe and renders.** Show render v1 (dark roast) and v2 (cream and green). "Each is drawn by a model; every version keeps its tokens and cost."
2. **Overview → Rebuild.** "We changed the look and rebuilt. The site took v2's exact palette; 15 of 15 colours and wordings from the render were found in the code." (Plan and steer page shows the overseer's notes and the percentage.)
3. **Plan and steer.** "Pro users can stop the build after the plan, edit it, and add instructions. We added 'Free Wi-Fi for every customer' and it is in the site."
4. **Tidy Bakes → Relay timeline.** "Same pipeline on a $0.07 cap: the negotiator granted from slack, then escalated, the Gate paused before the cap, we approved a raise, it finished."
5. **Quality vs cost.** Say plainly: one feature per project, so one point; the formula is on the page.

Say, if asked: no model has asked for budget on its own yet; the reviewer and overseer are small models.

## What to say when a screen is not live

- There is **no public link** (cut on purpose, see Q&A). The judges see the recorded video; a live run happens on the demo laptop only.
- If the live app fails: play the fallback video and say so. Never pretend.

## What is real and what is not (say this if asked, in this order)

1. **Real and live:** the cost estimator, the 57-model catalog, what-if and conflicts, Easy
   and Pro, the Budget Gate, and the relay on Gemini's free tier with briefs and negotiator
   decisions recorded.
2. **Built and tested, not run live:** Claude and OpenAI/OpenRouter calls (no paid keys yet).
3. **Not done:** a sandbox for generated code; Claude and OpenAI live runs. A generated app
   did pass every check once (cafe specials, $0.02), with one known flaw: an unrequested
   login wall that the reviewer approved.

## Fallback video (record once, early)

Screen-record, about 90 seconds, in this order: Easy price screen → Pro what-if with a
conflict → Cafe specials relay timeline (open a brief) → ledger. No narration needed; subtitles
from this table. Save it in two places (laptop and a phone) and upload it somewhere the
submission form can link.

## The deck

Slides (10, with speaker notes): https://claude.ai/artifact/4Q3789KKj8CkdATadjiJkh
It is private until its owner shares it from the page's Share menu. Download it as PDF or PPTX
from the page for the submission, and keep a copy on a phone.
