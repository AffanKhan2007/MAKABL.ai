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

**Is the relay real?** Yes, it ran live on Gemini's free tier: a spec brief, an architect plan
built from only that brief, handoffs that carried 32% and 44% fewer tokens than the full
history, and negotiator decisions, all in the event log.

**Did it build a working app?** Not end to end yet. A run's checks failed with the smallest
model, and the next run hit Google's free daily quota (20 requests). A paid key would let us
show a full build; we say so rather than fake it.

**How accurate are the estimates?** They are ranges, wide on purpose. Until 10+ real runs per
feature type are logged they come from a modelled prior, and the app says that on screen. The
first real runs started the track record this weekend.

**Where do the prices come from?** The three vendors' official pricing pages, checked on
31 Oct, with a re-check date after which the app marks them as unverified.

**Does the savings claim (briefs) hold?** Measured on one real run: 32% and 44% fewer tokens
passed between phases. One run is not a benchmark; we have no averages yet.

## About safety and money

**What stops it overspending?** Before every model call the Budget Gate reserves the call's
worst-case cost; if that would cross your cap it pauses and asks. Calls the provider refused
are released, not booked. This is tested.

**Is generated code sandboxed?** No. It runs on a dedicated build laptop. Do not run builds
on a machine with personal data. A container sandbox is next.

**What happens to my prompts?** On Gemini's free tier Google may use prompts to improve its
products, and the app warns about this before a build. Use a paid key for private projects.

**Can strangers use the public link to spend your money?** The public demo runs with live
builds and API keys turned off.

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
