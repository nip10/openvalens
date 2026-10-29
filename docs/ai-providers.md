# AI providers

AI features (Coach chat, insights, extraction) run on **Anthropic** or on **any
OpenAI-compatible Chat Completions endpoint** — Ollama, vLLM, llama.cpp,
LM Studio, or a hosted compatible API (Issue #59). AI is **off by default**,
and every call stays behind the organization and per-user consent gates
whichever provider is selected.

## Turning AI on

Three switches must all be on before any AI call runs:

1. **Server** — configure a provider (below). Readiness then reports
   `ai: configured`.
2. **Workspace** — the workspace owner opens **Settings → AI for this
   workspace** (web or mobile) and turns it on. Only the owner can change it,
   and not from an impersonated session; other members see the state
   read-only. This writes `organization.metadata.aiConsent` as
   `{ "enabled": true, "scope": "full" }` (turning it off writes
   `{ "enabled": false }`), keeps the other metadata keys, and records an
   `AI_WORKSPACE_CONSENT_CHANGED` audit entry. API: `ai.workspaceConsent.get`
   / `ai.workspaceConsent.set`.
3. **Person** — each person, the owner included, turns on **Settings → AI
   processing** for themselves (`ai.consent.grant`). Revoking it stops AI for
   that person only.

Until all three are on, AI calls fail with `403 AI_DISABLED`.

## Coach chat history

Coach chats are private to the person who wrote them, also in a shared
workspace: every chat row carries `user_id`, and listing or continuing a
conversation only ever reads the caller's own rows. A client sends only the
new message (`ai.chat({ conversationId, message })`); the server loads the
newest 40 earlier messages of that conversation as context and stores just the
new message and the reply. Export and erasure treat chats as the author's data.

## Configuration

| Key                              | Values / default                      | Notes                                                                                  |
| -------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------- |
| `AI_PROVIDER`                    | `anthropic` \| `openai-compatible`    | Unset = AI off (`ai: off` on readiness), unless the legacy `ANTHROPIC_API_KEY` is set. |
| `AI_BASE_URL`                    | URL                                   | Required for `openai-compatible`. Must not embed credentials.                          |
| `AI_API_KEY` / `AI_API_KEY_FILE` | secret                                | Optional for local servers. For `anthropic`, falls back to `ANTHROPIC_API_KEY`.        |
| `AI_MODEL`                       | Anthropic default `claude-sonnet-5-5` | Required for `openai-compatible`; no local model is hard-coded.                        |
| `AI_SUPPORTS_STRUCTURED_OUTPUTS` | `false`                               | Set `true` only if the endpoint honours JSON-schema `response_format`.                 |

Local Ollama, no cloud credentials:

```sh
AI_PROVIDER=openai-compatible
AI_BASE_URL=http://localhost:11434/v1
AI_MODEL=<a model you have pulled>
```

On the self-host Compose stack these keys go in `deploy/.env` and the key in
`deploy/secrets/server/AI_API_KEY`; `AI_BASE_URL` must be reachable from inside
the `server` container, where `localhost` is the container itself. See
[Configuration › AI provider](self-hosting/configuration.md#ai-provider).

Existing deployments that only set `ANTHROPIC_API_KEY` keep using Anthropic.
A misconfigured selection (unknown `AI_PROVIDER`, `openai-compatible` without
`AI_BASE_URL` or `AI_MODEL`, a malformed URL) fails startup with
`AI_CONFIG_INVALID`; a missing key never does — AI is reported `off` instead.

The endpoint must speak Chat Completions (`POST {AI_BASE_URL}/chat/completions`).
The adapter uses `@ai-sdk/openai-compatible`, not `@ai-sdk/openai`, which
targets the Responses API that local servers implement poorly.

## No tool-calling dependency

Tool calling is an enhancement, never a requirement. Ollama ignores
`tool_choice`, vLLM needs `--enable-auto-tool-choice` and a parser flag, and
llama.cpp needs `--jinja`. So:

- **Chat** offers the health tools. If the endpoint rejects a request that
  carries `tools` (any 4xx/5xx other than 401, 403, 408 or 429) before any
  text has streamed, the turn is retried once without tools and answered from
  the conversation alone. The fallback is logged as
  `ai.chat.stream.tools_unsupported` with the provider, host and status.
- **Extraction** never uses tools. The model is asked for JSON in plain text;
  the reply is validated with Zod, retried once, and otherwise returned as
  `status: "unparseable"` with `data: null`. Values are never invented, and an
  unparseable result must never be persisted.
- **Insights** use plain text.

No code sets `temperature`, `top_p` or `top_k`: Claude 4.7+ rejects non-default
sampling values.

## Monthly usage cap

Every AI call (Coach chat, extraction, insights, food drafts) is recorded per
person per calendar month (UTC) in `ai_usage_month`: input, output and cached
input tokens as the provider reports them, the estimated cost and the number
of provider calls. Only counts are stored and logged, never a prompt, a reply
or a health value. Each model step of a chat turn counts, including steps of a
turn that later fails. When a step fails after its answer had started
streaming, the provider never reports its usage, so it is estimated from the
prompt and the streamed text length.

A cap is off unless the operator sets one, so self-host behaviour does not
change. The cap is a cost, not a token count, because output tokens cost
several times more than input tokens; the per-token prices of the configured
model turn it into the right token budget:

| Key                              | Example | Notes                                                                  |
| -------------------------------- | ------- | ---------------------------------------------------------------------- |
| `AI_MONTHLY_COST_LIMIT`          | `1.50`  | Per person per month. Unset = no cap. Required in Cloud when AI is on. |
| `AI_PRICE_INPUT_PER_MTOK`        | `1.72`  | Price of one million input tokens of `AI_MODEL`. Needed with a cap.    |
| `AI_PRICE_OUTPUT_PER_MTOK`       | `8.60`  | Price of one million output tokens. Needed with a cap.                 |
| `AI_PRICE_CACHED_INPUT_PER_MTOK` | `0.17`  | Prompt-cache reads. Defaults to the input price.                       |
| `AI_COST_CURRENCY`               | `EUR`   | Currency of the limit and prices (display only; nothing is converted). |

The example is OpenValens Cloud: about €1.50 of model cost per person per
month on the default `claude-sonnet-5-5`, whose list prices are $2 (input),
$10 (output) and $0.20 (cache reads) per million tokens, converted at about
€0.86 per US dollar. Re-check the exchange rate and the provider's price list
when you set them, and update the prices whenever `AI_MODEL` changes. Prices
without a limit only add cost estimates to the operator view.

A limit without both prices, or `DEPLOYMENT_MODE=cloud` with AI configured and
no limit, stops the server at startup with `AI_CONFIG_INVALID`.

**How the cap is checked.** Before each call the server locks the person's
row for the month and refuses when the recorded cost plus the budget held by
calls still running reaches the limit. Otherwise it holds an estimate for
this call (the prompt at about 3 characters per token plus 1,024 output
tokens) and replaces it with the real usage when the call ends. Parallel
requests therefore see each other, but a call that is let through can still
cost more than its estimate: the month can end slightly over the limit by
what the calls already in flight spend (normally one chat turn of at most 5
model steps). A hold lapses after 10 minutes if the server dies mid-call. All
of this lives in Postgres, so the cap holds across restarts and replicas.

**When the cap is reached** the call fails with `429 AI_USAGE_LIMIT_REACHED`
and `data.resetsOn` (the first day of next month, `YYYY-MM-DD`). Coach on web
and mobile says the monthly AI allowance is used up and shows that date in the
person's locale. Nothing is silently degraded or answered by another model.

**Operator view.** Instance administrators see this month's totals (tokens,
estimated cost, calls, people) and the ten accounts with the highest usage by
opaque user id, under **Instance configuration › AI usage** on the web
(`adminSettings.aiUsage`).

The per-minute limit (`AI_RATE_LIMIT_PER_MINUTE`) is still kept in memory per
server process: it resets on restart and is not shared across replicas. The
monthly cap is what bounds cost.

## Logging and secrets

AI logs carry the provider id and endpoint host (`host:port`) only — never the
key, the full base URL, prompts, or completions. Provider failures are logged
as a value-free `category` / `status` / `retryable` summary. Readiness reports
`{ "provider": "openai-compatible", "state": "configured" }` and never the URL.
`AI_API_KEY` and `ANTHROPIC_API_KEY` are `@sensitive` and accept `_FILE`.

## Tested models

No local model has been verified against this release yet. The table is filled
by running Coach chat, structured extraction, and refusal of out-of-scope
medical advice against each model; add a row with the date when you do.

| Date tested | Server | Model | Chat | Structured extraction | Tool calling | Out-of-scope refusal |
| ----------- | ------ | ----- | ---- | --------------------- | ------------ | -------------------- |
| —           | —      | —     | —    | —                     | —            | —                    |

## Not yet implemented

- Consent is not yet bound to the configured provider: changing
  `AI_PROVIDER` or `AI_BASE_URL` does not re-prompt existing consent, and the
  consent screen does not yet name the provider or host.
