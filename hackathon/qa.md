# Q&A sheet: the hard questions, one honest answer each

Rule: answer in one or two sentences, say what is real, and never claim more than the demo
showed. If you do not know, say "we haven't measured that yet".

## About the idea

**Why does this need to exist?** AI builders charge by usage and give no forecast, so people
discover the cost after. Our own research found build costs for identical tasks vary by an
order of magnitude. MAKABL forecasts first and caps the spend.

**How is this an "auto-economy"?** Each AI model is a worker with its own allowance carved
from one budget. A token negotiator grants more, moves spare budget between workers, or
escalates to the human. Models are chosen per job by price and fit, across vendors.

**Who is it for?** People who are not engineers and want an app built (a restaurant owner),
and people who are, who want control over which model does what (Pro mode).

**What is new about it?** Per-phase pricing across vendors, a negotiator that reallocates a
budget between models mid-build, and a gate that reserves worst-case cost before every call.

## About whether it works

**Is the relay real?** Yes, it ran end to end live on Gemini's free tier: a spec brief, an
architect plan from only that brief, a builder, and a reviewer. Handoffs carried 36%, 74% and
95% fewer tokens than the full history, and the negotiator's decisions are in the event log.

**Did it build a working app?** Yes, once, on Gemini's free tier: a one-page cafe specials site
that passed its type check, its own tests and the production build on the first attempt, for
$0.02 of a $2.00 cap. It also added a login wall nobody asked for, and the small reviewer model
approved it. We report that rather than hide it. Earlier runs failed (wrong imports, then the
free daily quota), so one success is not a success rate.

**How accurate are the estimates?** They are ranges, wide on purpose. Until 10+ real runs per
feature type are logged they come from a modelled prior, and the app says that on screen. The
first real runs started the track record this weekend.

**Where do the prices come from?** The three vendors' official pricing pages, checked on
31 Oct, with a re-check date after which the app marks them as unverified.

**Does the savings claim (briefs) hold?** Measured on one real run: the review phase got a
1.9K-token brief instead of 42K of build history. One run is not a benchmark; we have no
averages yet.

**Did you see models negotiate for real?** Partly. On a real build with a $0.07 cap the
negotiator granted room from slack seven times, handed unspent allowance back twice, then
escalated to the owner when none was left; the Gate paused before the cap and the build
resumed after we approved a raise. The builder model never asked for budget itself (it made
zero `request_budget` calls), so a model-initiated request is tested but not seen live.

**Does the built site match the render?** We measured it. After changing a render to a lighter
look and rebuilding, the site took the new palette exactly and 15 of 15 colours and wordings
from the render were found in the code. That is one page on a small model; images are emoji
and CSS only.

**Who checks the builder's work?** Tests and checks, a reviewer model, and an overseer that
compares the code to the render and the owner's instructions. The reviewer and overseer are
the same kind of small model as the builder, so they are not independent judges; the colour
and wording check is mechanical.

**What can a Pro user control?** Pause after the plan or after every feature, edit the
architect's plan, add instructions for one feature or all, choose a render version and rebuild
from it, and read quality against cost per feature.

**Why were cheap builds costing so much?** Cheap models invented extra features. One run built
an inventory app with sign-in from "five items with prices". Stricter prompts cut a test build
from 26 model calls and $0.097 to 8 calls and $0.019. One run, not a benchmark.

## About safety and money

**What stops it overspending?** Before every model call the Budget Gate reserves the call's
worst-case cost; if that would cross your cap it pauses and asks. Calls the provider refused
are released, not booked. This is tested.

**Is generated code sandboxed?** No. It runs on a dedicated build laptop. Do not run builds
on a machine with personal data. A container sandbox is next.

**What happens to my prompts?** On Gemini's free tier Google may use prompts to improve its
products, and the app warns about this before a build. Use a paid key for private projects.

**Can strangers use a public link to spend your money?** There is no public link. We cut it on purpose: the app has open sign-up and runs unsandboxed builds with API keys, so exposing the demo laptop would let strangers spend quota and run code on it. The demo is a recorded video plus a local run.

## About the work

**What did you build this weekend?** The relay and negotiator, the live Gemini, Claude and
OpenAI/OpenRouter adapters, the 57-model catalog, what-if and conflicts, Easy and Pro modes,
the timeline, theme switching, and the new UI. The prior-work line is in the submission form
(`hackathon/DISCLOSURE.md`); answer in one sentence if asked and move on.

**What would you do with another month?** A real sandbox; paid-key runs on every vendor to
calibrate the estimator; models that ask the negotiator themselves through a tool;
deployments with approval.

**What are the biggest weaknesses?** No sandbox, estimates not yet calibrated, a full
generated app not yet shown on a free tier. We list them in the README.
