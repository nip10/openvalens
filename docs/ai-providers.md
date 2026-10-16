# AI providers

AI features (Coach chat, insights, extraction) run on **Anthropic** or on **any
OpenAI-compatible Chat Completions endpoint** — Ollama, vLLM, llama.cpp,
LM Studio, or a hosted compatible API (Issue #59). AI is **off by default**,
and every call stays behind the organization and per-user consent gates
whichever provider is selected.

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
