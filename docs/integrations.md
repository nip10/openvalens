# Integration adapters

OpenValens uses a deliberately narrow set of external services. Every one of
them is **optional**: a default self-hosted install needs **zero vendor
accounts**, boots, and reports each integration family at a safe default on the
readiness probe (Issue #57).

## v1 adapter set

| Family       | Adapters                                                           | Default with no vendor env     | Enable with                                                     | Status      |
| ------------ | ------------------------------------------------------------------ | ------------------------------ | --------------------------------------------------------------- | ----------- |
| `email`      | Resend (only transport, Issue #61)                                 | `dry-run` — sends are logged   | `RESEND_API_KEY` and `EMAIL_DRY_RUN=false`                      | Implemented |
| `ai`         | Anthropic                                                          | `off` — `ai.chat` fails closed | `AI_PROVIDER=anthropic` + `AI_API_KEY`                          | Implemented |
| `messaging`  | Telegram                                                           | `off` — no delivery            | `TELEGRAM_BOT_TOKEN`                                            | Implemented |
| `ai`         | Any OpenAI-compatible endpoint (Ollama, local)                     | `off` — `ai.chat` fails closed | `AI_PROVIDER=openai-compatible` (#59)                           | Implemented |
| `foodLookup` | Open Food Facts live barcode lookup (#69)                          | `off` — local catalogs only    | `FOOD_LOOKUP_PROVIDER=openfoodfacts` + `FOOD_LOOKUP_USER_AGENT` | Implemented |
| `storage`    | Local disk, S3-compatible (S3, R2, MinIO, B2)                      | Local disk, private            | `STORAGE_PROVIDER=s3` + `STORAGE_S3_*`                          | Implemented |
| `push`       | Expo push service (forwards to APNs/FCM, #92)                      | `off` — push shown unavailable | `PUSH_PROVIDER=expo`                                            | Implemented |
| `oidc`       | One generic OIDC provider (local accounts stay)                    | `off` — local accounts only    | `OIDC_*` env (Issue #65)                                        | Implemented |
| `wearables`  | Phone-first ingestion; Oura, Whoop, Polar, Withings, Google Health | Phone-first, no vendor         | Per-vendor env (Issue #60)                                      | Implemented |
| Errors       | Sentry (server, web, JS-only mobile), PHI-scrubbed (#54)           | `off` — nothing is sent        | `SENTRY_DSN` (+ `VITE_SENTRY_DSN`, `EXPO_PUBLIC_SENTRY_DSN`)    | Implemented |
| Analytics    | PostHog, consent-gated (#53)                                       | `off`                          | `ANALYTICS_ENABLED` + token                                     | Implemented |

See [AI providers](ai-providers.md) for AI provider selection and the
no-tool-calling guarantees, [Object storage](storage.md) for storage, and
[Wearables](wearables.md) for the phone-first path and each cloud adapter's
redirect URI, scopes and webhook.

`foodLookup` is only asked for a barcode that the member's private foods and
the imported FDC/Open Food Facts catalogs all miss. It sends the product code
and `FOOD_LOOKUP_USER_AGENT` (an app name and operator contact, as Open Food
Facts requires) and nothing else; `FOOD_LOOKUP_BASE_URL` can point it at a
privacy proxy. Store and variable-measure codes are never sent. A timeout or
rate limit degrades to a manual-entry fallback, and manual food logging never
depends on it.

Not in v1: SMS, search engines (use Postgres), payments, extra email vendors,
SMTP, direct APNs/FCM push (push goes through the Expo push service only).

## Readiness

`checks.integrations` on the readiness probe
([deployment guide](deployment.md#6-health-readiness)) reports one entry per
implemented family:

```json
{
  "email": { "provider": "resend", "state": "dry-run" },
  "ai": { "provider": null, "state": "off" },
  "messaging": { "provider": null, "state": "off" },
  "storage": { "provider": "local", "state": "configured" },
  "foodLookup": { "provider": null, "state": "off" },
  "oidc": { "provider": null, "state": "off" },
  "push": { "provider": null, "state": "off" },
  "wearablesOura": { "provider": null, "state": "off" },
  "wearablesWhoop": { "provider": null, "state": "off" },
  "wearablesPolar": { "provider": null, "state": "off" },
  "wearablesWithings": { "provider": null, "state": "off" },
  "wearablesGoogleHealth": { "provider": null, "state": "off" }
}
```

| State        | Meaning                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| `configured` | A provider is selected and its credentials are present; real calls happen. |
| `dry-run`    | Work is accepted but never reaches a provider (logged only).               |
| `off`        | The family is disabled; callers fail closed or skip. `provider` is `null`. |

`dry-run` and `off` are safe defaults and never degrade the readiness status.
The entry is value-free: the provider id and state only, never a key, URL or
account id. The legacy `checks.capabilities` booleans are derived from the same
statuses (`true` only when `configured`).

## The adapter contract

These are the rules every family follows. There is no generic plugin framework,
adapter registry or dynamic loading — just one small interface per family and a
shared status vocabulary.

1. **One interface per family, in the package that owns the domain.** For
   example `EmailProvider` in `@openvalens/email`. Add an abstraction only when
   a second implementation actually exists.
2. **Adapter modules live in `src/providers/<provider>.ts`** of that package
   (for example `packages/ai/src/providers/anthropic.ts`). They are the only
   files allowed to import a vendor SDK: the `no-restricted-imports` rule in
   `.oxlintrc.json` rejects vendor SDK imports anywhere else, and
   `packages/config/src/integrations.test.ts` proves the boundary. A new vendor
   SDK must be added to that rule's list in the same change. Adapters that talk
   to a plain HTTP API with `fetch` need no SDK.
3. **Pure config, bound by the server.** The package exports
   `parse<Family>Config(env)`, which validates a plain env object and never
   reads `process.env`. `apps/server/src/services.ts` parses its varlock `ENV`
   and constructs the adapter. Packages receive config or a built service by
   injection.
4. **Selected by env, off by default.** Credentials and provider selection are
   varlock env keys in `apps/server/.env.schema` (secrets marked `@sensitive`,
   with a `_FILE` variant). When a family has more than one adapter it is
   selected with `<FAMILY>_PROVIDER` (an `@type=enum(...)`). Missing credentials
   mean `off` or `dry-run`, never a boot failure. Switching providers is an env
   change and a restart, never a code change. Run `bun run docs:generate` after
   editing the schema.
5. **Report a value-free status.** The package exports
   `describe<Family>Integration(config): IntegrationStatus` using the types in
   `@openvalens/config/integrations` (import them with `import type`). The
   server adds it to `integrations` in `services.ts`; readiness projects it to
   `{ provider, state }`.
6. **Normalise errors at the boundary.** Map provider failures to typed errors
   with a category and retryability, and log them with a value-free summary
   (see `EmailTransientError`, `EmailPermanentError` and
   `describeEmailDeliveryError` in `@openvalens/email`). Never log a provider
   message body, request payload, credential or health value.
7. **Keep user data behind the existing gates.** Adapters that send user data
   (AI) stay behind the consent and redaction gates. Opt-in telemetry sends
   nothing unless the operator explicitly enables it.
8. **Test without vendors.** Each adapter has contract tests with an injected
   fake or a mock HTTP server; integration tests use disposable local services.
   Tests never call a live provider and use synthetic data only.
9. **No cross-family coupling.** A family depends on the shared status types,
   never on another family's adapters, so each family ships independently.

## Adding an adapter

1. Add env keys to `apps/server/.env.schema` (optional, with a safe default) and
   run `bun run docs:generate`.
2. Extend `parse<Family>Config` and `describe<Family>Integration`, with unit
   tests for the default (`off`/`dry-run`) and the enabled state.
3. Put the implementation in `src/providers/<provider>.ts`; add any vendor SDK
   to the `no-restricted-imports` list in `.oxlintrc.json`.
4. Bind it in `apps/server/src/services.ts` and add the family to
   `integrations` if it is new.
5. Add contract tests for the adapter and update the table above.
