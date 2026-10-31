# OpenRouter: how it fits MAKABL

Status: **design, not built.** Researched 31 Oct 2026 from OpenRouter's own docs. Anything
marked **VERIFY** was not confirmed and must be checked with a real key before code depends on
it (step 1 of the build plan).

## 1. Decision in one paragraph

The relay (#17) needs to call models from three vendors. We already have a direct Claude
adapter. For **OpenAI and Gemini phases** (spec, architect, review) we add **one** adapter that
talks to OpenRouter instead of writing two vendor adapters. The **build phase stays on the direct
Claude adapter**, because it is the biggest spend and needs the exact, tested cost path.

| | Two direct adapters | One OpenRouter adapter (recommended) |
|---|---|---|
| Code | OpenAI SDK + Gemini SDK, two usage formats | One chat-completions client |
| Keys to get and send | OpenAI + Google | One OpenRouter key |
| Models reachable | Two vendors | Every model OpenRouter lists |
| Price | Vendor list price | Same list price **plus 5.5% when buying credits** |
| Moving parts in the demo | Fewer | One more service |

## 2. What OpenRouter is (facts from the docs)

- Base URL `https://openrouter.ai/api/v1`, auth header `Authorization: Bearer <key>`.
- Two APIs: **Chat Completions** (`/chat/completions`, OpenAI-style) and **Responses**
  (`/responses`). **We use Chat Completions**: our build loop already works in
  messages-and-tool-calls terms.
- Model ids are `<provider>/<slug>`, for example `openai/gpt-6.1-terra`. A `~` prefix marks a
  "latest" alias; **we never use aliases**, since the price can change under us.
- Optional headers: `HTTP-Referer` and `X-OpenRouter-Title` (for OpenRouter's rankings only).
- **Money:**
  - No markup: "inference is billed at the provider's list price on every plan."
  - **5.5% fee when buying credits** (Standard plan). Not per request.
  - Bring-your-own-key (BYOK): first $25,000/month of list-price inference has no OpenRouter
    fee, then 5%. Not worth it for us: BYOK means we need every vendor's key again.
  - Paid models: no plan-based rate limit. Free models: 20 requests/min, 50/day (1,000/day
    after buying $10). We do not use free models in a demo.
- **Errors:** 400 bad parameters, 401 bad key, **402 out of credits**, 403 blocked, 408, 413,
  422, 429 rate limit, 500, 502 upstream failure, 503, 524, 529 provider overloaded.

## 3. What a call and its cost look like

Request (non-streaming, tool use):

```json
{
  "model": "openai/gpt-6.1-terra",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "tools": [{ "type": "function", "function": { "name": "write_file", "description": "...", "parameters": { "type": "object", "properties": {}, "required": [] } } }],
  "max_completion_tokens": 4000,
  "provider": { "data_collection": "deny", "allow_fallbacks": true }
}
```

Response, the parts we use:

- `choices[0].message.content` (string or null) and `choices[0].message.tool_calls`, each
  `{ id, type: "function", function: { name, arguments } }` where `arguments` is a **JSON
  string** we must parse.
- `choices[0].finish_reason`: `stop`, `tool_calls`, `length`, `content_filter`, `error`.
- `usage`: `prompt_tokens`, `completion_tokens`, `total_tokens`, and **`cost`**, "the total
  charged to your account". Always included: nothing to switch on (`usage.include` is
  deprecated).
- `usage.prompt_tokens_details.cached_tokens` (read from cache) and `cache_write_tokens`
  (written, only for models with explicit cache pricing). **VERIFY** exact field names on the
  chat-completions response with a real call; the docs page I could read did not show the
  response wrapper.
- Tool results go back as `{ "role": "tool", "tool_call_id": "<id>", "content": "<string>" }`,
  and the `tools` array must be sent again on every request.

## 4. How it plugs into the Budget Gate

Every model call must go through `BudgetGate.execute` (no unbudgeted path). Same shape as
`src/adapters/claude.ts`:

1. **Reserve** the worst case before sending.
2. **Send** to OpenRouter.
3. **Settle** to the observed cost.

Differences from the Claude adapter, and what we do about each:

| Issue | Claude adapter | OpenRouter adapter |
|---|---|---|
| Exact prompt size | `countTokens` API call | No count endpoint known. **Estimate** with `ceil(chars / 3)` plus 25% headroom. Over-reserving is safe; it only pauses the build earlier |
| Worst case | prompt × input rate + `max_tokens` × output rate | Same formula using the registry's rates for the model, applied to the estimated prompt and `max_completion_tokens`. Use the **long-prompt** rates when the estimate is over the model's threshold |
| Observed cost | Priced from `usage` and our registry | **Use `usage.cost`** (actual) × **gateway fee factor 1.055**, rounded up to whole micros. If `cost` is missing, price from tokens with the registry and mark the basis as `estimated` |
| Basis recorded | `usage_observed` | `usage_observed` when `cost` is present; `estimated` otherwise |
| Failed call | Gate books the worst case | Same. OpenRouter charges nothing for a 4xx, but a 502/524 after the provider started may still bill, so keep booking the worst case |
| Idempotency | Key per logical step | Same key; a replayed step must not pay twice |
| Retry on 429/502/529 | n/a | One retry with a new `:rN` attempt key (same rule as `recoverInterrupted`), then fail the step |

**Why the 1.055 factor:** `usage.cost` is the inference cost only. The 5.5% is charged when
credits are bought, so the real dollars spent are about 5.5% higher. Booking the factor keeps
the Gate's number at or above reality. It lives in one constant so it can change.

**Reasoning tokens** count as completion tokens and are billed. `max_completion_tokens` should
therefore be set generously on reasoning models, and the worst case must use the same number.

## 5. Registry changes

Today `src/registry/models.ts` has one price per model, from the vendor's page. Add:

```ts
// on PriceEntry
route?: 'direct' | 'openrouter';       // default 'direct'
openrouterId?: string;                 // e.g. 'openai/gpt-6.1-terra'; required when route is 'openrouter'
```

- All Anthropic models: `route: 'direct'`.
- OpenAI and Google models: `route: 'openrouter'`, with `openrouterId` set **only after** it is
  confirmed in `GET /api/v1/models` (see "Unverified model ids" below).
- A model with no confirmed `openrouterId` is **not runnable live**. The conflicts panel already
  has a "cannot run live" blocker; it will use this instead of the current "no adapter" text.
- Prices in the registry stay the vendor list prices (OpenRouter passes them through). The
  adapter's observed cost comes from `usage.cost`, so a mismatch between the two is itself a
  useful signal: log it and flag it if they differ by more than 10%.

### Unverified model ids

I could not confirm which of our 57 models OpenRouter carries or under which slug:

- A search for GPT-6 models showed **`openai/gpt-6.1-terra`** at $1 / $5 per million tokens,
  matching our registry. It showed no Claude 5.5, Gemini 4, 3.8 or 3.1 models on that page,
  but the query was narrow, so this proves nothing either way.
- A direct fetch of `/api/v1/models` returned content in a different format (Anthropic-style
  ids such as `anthropic/claude-fable-5.1[1m]`). I do not trust it as OpenRouter's catalog.
- **VERIFY first:** with a real key, `GET https://openrouter.ai/api/v1/models`, and record the
  exact ids and pricing for each model we want. Models OpenRouter does not carry stay
  Claude-direct or simulated.

## 6. Conflicts and shortcomings to add (for the panel)

| id | Severity | Says |
|---|---|---|
| `gateway-fee` | info | Non-Claude phases go through OpenRouter, which adds about 5.5% when credits are bought. The plan includes it |
| `gateway-model-missing` | block (live only) | OpenRouter does not list this model, so the phase cannot run live |
| `gateway-fallback` | info | OpenRouter may reroute to another provider of the same model if one is down; price and speed can differ slightly |
| `gateway-data` | info | Requests are sent with `data_collection: "deny"`; some providers are excluded because of it, which can reduce availability |
| `gateway-cache` | info | Prompt caching behaves per provider through the gateway; savings may be lower than the direct-API figures in the plan |

The estimator should also add the 5.5% to phases routed through the gateway, so the plan and
the ledger agree. Easy mode shows none of this: at most "one AI service is not connected yet".

## 7. Safety and privacy

- The key goes in `.env.local` as `OPENROUTER_API_KEY`. The repo is public: never commit it,
  paste it in chat, or put it in a screenshot.
- Buy a **small amount of credits** (about $5) so the account itself is the hard cap. **VERIFY**
  whether per-key credit limits exist in the dashboard and set one if so.
- Send `provider: { data_collection: "deny" }` on every request so prompts are not used for
  training by providers that would. **VERIFY** that this does not block the models we need.
- Never log the key, and never put it in an error message. The adapter reads it from the
  environment and only the transport sees it.
- Generated apps never get this key; the preview runner already scrubs the environment.

## 8. Build plan (about 2 hours)

| Step | Time | Done when |
|---|---|---|
| 1. **Smoke test** with a real key: list models, one tiny chat call, one tool call, one cached repeat; save the raw responses in a scratch folder (not the repo) | 20 min | We know the exact usage field names and which of our models exist |
| 2. Registry: `route` and `openrouterId`; fill ids from step 1 | 15 min | Test: every `route: 'openrouter'` model has an id |
| 3. `src/adapters/openrouter.ts`: transport interface, reserve/settle through the Gate, fee factor, retry | 45 min | Mirrors `test/claude-adapter.test.ts` with a fake transport: reserves worst case, settles to `cost × 1.055`, replays on the same key, books worst case on failure |
| 4. Estimator and conflicts: add the gateway fee and the new rules | 20 min | Plan for a relay with an OpenAI spec phase is about 5.5% higher on that phase |
| 5. Relay uses the adapter by `route` | with #17 | A simulated-then-live run of one non-Claude phase |
| 6. One real call under a $0.05 cap, then check the ledger against the OpenRouter dashboard | 10 min | Our booked cost is at or above the dashboard's |

Tests use a fake transport, so nothing here spends money until step 6. No live call is made
without the key and Affan's go-ahead.

## 9. Risks

| Risk | Likelihood | What we do |
|---|---|---|
| A model we want is not on OpenRouter | Medium | It stays Claude-direct or simulated; the panel says so |
| `usage.cost` missing or in a different unit than expected | Low | Fall back to token pricing; basis becomes `estimated`; found in step 1 |
| Cost slightly above the Gate's number because of provider fallback | Low | The 1.055 factor and 25% prompt headroom absorb it; ledger vs dashboard check in step 6 |
| OpenRouter down during the demo | Low | The demo path does not need it: the cost plan, Easy and Pro modes work without any key. A relay phase falls back to simulated, labelled |
| Time: it eats the relay's hours | Medium | Hard stop at 2 hours; if the smoke test fails, fall back to direct OpenAI only and leave Gemini simulated |

## 10. For the pitch and Q&A

One line, honest: "Claude is called directly; OpenAI and Gemini phases go through a gateway,
OpenRouter, so we need one key instead of three." Do not say all vendors are called directly.

## 11. Who does what

- **Affan:** creates the OpenRouter account, buys about $5 of credits, creates the key, sends it
  to Nishant privately (not the group chat).
- **Nishant:** runs step 1 (smoke test) and step 6 (the real call) on his laptop, because live
  calls run there. Posts the raw model list and usage responses.
- **Claude Code (this repo):** steps 2 to 5.
