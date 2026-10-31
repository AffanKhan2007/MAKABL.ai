# Can MAKABL drive Lovable, Base44, Replit and Wix? (researched 31 Oct 2026)

Short answer: **one is real, one is possible, two are not found.** Read from each
platform's own documentation today; "not found" means not in the pages I could read, not
proof it does not exist.

| Platform | Programmatic way in | Can it build from a prompt? | Auth | Cost | Verdict |
|---|---|---|---|---|---|
| **Lovable** | MCP server at `https://mcp.lovable.dev` | **Yes.** `create_project`, `send_message` (the AI agent builds; waits by default or poll with `get_message`), `get_project` returns the **editor URL, preview URL and a screenshot**, plus `list_files`, `read_file`, `get_diff`, `deploy_project` | **OAuth only. No API key.** A browser login, scopes granted by the user. Custom OAuth clients can be registered on all plans; localhost clients need no approval | `create_project` and `send_message` **use Lovable credits** | **Real and feasible**, but needs a Lovable account with credits and an interactive login |
| **Base44** | CLI (`base44 create`, `base44 login`, deploy), MCP server at `https://app.base44.com/mcp`, an SDK and REST APIs | **Unclear.** Docs say the MCP server can "create and manage projects, query project data, and edit an app's code in its sandbox". They do not say it runs the AI builder from a prompt or returns a preview URL | OAuth for the MCP server; `base44 login` for the CLI | Not stated | **Possible, unverified.** Needs a 30-minute test with a real account |
| **Replit** | An MCP server for external clients, a Compliance API (audit data only), Routines (run inside Replit) | **Not found.** No REST API, SDK or CLI for running Replit Agent from outside | n/a | n/a | **Not found.** Would need a different route (for example, Git) |
| **Wix** | Large REST and SDK surface (sites, headless, CLI apps) | **Not found.** I did not find an endpoint that generates a site from a prompt with Wix's AI; the APIs manage sites and apps you build yourself | n/a | n/a | **Not found.** Wix APIs build on Wix, they do not drive its AI builder |

## What this means for the pitch

Do **not** tell anyone MAKABL builds through Lovable, Base44, Wix and Replit today. It does
not. What is true: MAKABL builds with its own relay of models, and Lovable exposes an API
that fits as an optional "builder" step. Say "a Lovable connector is the next step", not "we
integrate".

## Status (31 Oct, evening)

Done: the live view of our own builds (#26) and the wireframe step in the architect brief
(#27). Not started: the Lovable connector (#28).

## What is achievable before the freeze (Sun 02:41)

1. **See the app being built live (our own builds).** Run the generated project's dev server
   during the build and embed it on the project page, refreshing as files are written.
   About 2 hours. Independent of any third party. Safe to demo.
2. **Match what the mentors were told.** Spec model → architect model that produces the
   **wireframe and the data model** → builder. Today the architect plans files and data;
   adding a wireframe section is a small prompt change. About 30 minutes.
3. **Lovable as an optional builder** (stretch, only if a 30-minute spike works): Nishant
   signs in once to Lovable with a localhost OAuth client, then MAKABL calls `create_project`
   and `send_message` with the architect's brief and shows the returned **preview URL and
   screenshot**. Needs Lovable credits (it spends them), an OAuth login that cannot be
   automated, and it would build outside our Budget Gate's exact cost control, so the plan
   must show it as "billed by Lovable, in credits".
4. **Base44** only after Lovable works, and only after confirming its MCP can run the
   builder from a prompt.

## Risks to say out loud

- Lovable and Base44 spend **their own credits**, not our dollars. The Budget Gate cannot
  reserve or settle those the way it does for model calls; it can only cap how many requests
  we send.
- OAuth means a person signs in once per machine. It cannot be baked into a shared key.
- The team has no budget. Lovable's free credits are limited and I have not checked how many.
- Each platform's terms may restrict automated use; read them before a public demo.
