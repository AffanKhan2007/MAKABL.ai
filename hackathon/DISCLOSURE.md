# Prior work disclosure

The rules allow work done before the event if it is disclosed. This is that disclosure.

## Built before the event (24–29 Oct 2026)

Everything up to and including the git tag `pre-hackathon`. In short:

- The research and plan documents in `docs/`.
- The core: pricing registry, cost estimator, Budget Gate (reserve and settle, task /
  project / monthly caps, approvals), event log, Postgres schema with row-level security.
- The build loop with a simulated model and a live Claude adapter (never run live before
  the event), the Next.js starter template for live builds.
- The web app: accounts, intake with acceptance criteria, cost plan, approvals, change
  requests, live feed, estimate vs actual, verification report, export and delete.
- The database-unavailable error handling (29 Oct).

## Built during the event (from 31 Oct 11:05 IST)

Everything after the `pre-hackathon` tag. See `git log pre-hackathon..HEAD`. Updated as we
go; the final list goes in the submission.

- (filled in during the event)

## How to check

```bash
git log --format='%h %ad %s' --date=iso pre-hackathon..HEAD
```

```bash
git diff --stat pre-hackathon HEAD
```

## Where this appears

Not in the pitch, the demo or the app. Only one line in the written submission (the
form's "prior work" field, or the README if there is no field):

> Built on our own prototype of the cost engine and Budget Gate (24–29 Oct). This
> weekend: live AI builds you can open and run, the redesigned app, and the public demo.
> Details: `hackathon/DISCLOSURE.md`, git tag `pre-hackathon`.

If a judge asks, answer in one sentence with the same facts and move on.
