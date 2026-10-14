# Observability & security headers

Last updated: 2026-10-14

> Implemented in Issue #9 (PHI-safe structured logger + correlation id),
> Issue #12 (CSP + security headers) and Issue #127 (enforced-CSP default +
> CSP violation sink). Source of truth for the header posture is
> `anchovy/apps/web/next.config.ts` + `anchovy/apps/web/src/lib/csp.ts`; the
> Hono equivalent lives in `packages/observability/src/security-headers.ts` and
> `packages/observability/src/middleware.ts`.

## 1. Security headers

Every response from `apps/server` — root, oRPC (`/rpc`, `/api-reference`),
Better Auth (`/api/auth/*`), cron endpoints and error responses — carries the
following headers, built by `buildSecurityHeaders()`:

| Header                         | Value                                                          | Rationale                                                                |
| ------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `Content-Security-Policy`      | see §2                                                         | Restricts script/style/connect sources; blocks plugin and base-tag abuse |
| `Strict-Transport-Security`    | `max-age=63072000; includeSubDomains; preload`                 | Force HTTPS for 2 years, all subdomains, eligible for preload lists      |
| `X-Frame-Options`              | `DENY`                                                         | Clickjacking defence (paired with CSP `frame-ancestors 'none'`)          |
| `X-Content-Type-Options`       | `nosniff`                                                      | Stop MIME-type sniffing                                                  |
| `Referrer-Policy`              | `strict-origin-when-cross-origin`                              | Send origin only, never the full path, to other origins                  |
| `Permissions-Policy`           | `camera=(), microphone=(), geolocation=(), interest-cohort=()` | Disable powerful APIs and FLoC interest-cohort tracking                  |
| `Cross-Origin-Opener-Policy`   | `same-origin`                                                  | Isolate the browsing context from cross-origin windows                   |
| `Cross-Origin-Resource-Policy` | `same-origin`                                                  | Prevent cross-origin reads of responses                                  |

Reference: [OWASP Secure Headers Project](https://owasp.org/www-project-secure-headers/).

These are global headers for every route. Per-route overrides are **not**
supported in this issue — if a future route needs a different policy, extend
`securityHeadersMiddleware` or add a route-level override at that point.

## 2. Content Security Policy

The CSP is the anchovy directive set, tightened:

```
default-src 'self';
script-src 'self' 'unsafe-inline' ['unsafe-eval' in dev];
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'self' api.resend.com api.telegram.org;
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
object-src 'none'
```

Notes:

- `'unsafe-inline'` is required by the TanStack/Tailwind runtime and mirrors
  anchovy. A nonce/hash-based policy is a future hardening step.
- `'unsafe-eval'` is only added when `allowDevScriptEval` is `true`. The server
  passes `NODE_ENV === "development"`, so only development allows eval —
  production and test never do.
- `connect-src` allowlists the two external integrations used by the platform:
  Resend (`api.resend.com`) and Telegram (`api.telegram.org`).
- `frame-ancestors 'none'` matches `X-Frame-Options: DENY`.

## 3. CSP rollout (staged)

Production defaults to **enforced** CSP (Issue #127); every other environment
defaults to **report-only** so a policy change cannot break a local client
before it is validated.

The effective mode is resolved at boot by `resolveCspMode(NODE_ENV, CSP_MODE)`
in `apps/server/src/security-csp-report.ts`:

| `NODE_ENV`   | `CSP_MODE` (explicit) | Effective mode | Header                                |
| ------------ | --------------------- | -------------- | ------------------------------------- |
| `production` | unset                 | `enforce`      | `Content-Security-Policy`             |
| `production` | `enforce`             | `enforce`      | `Content-Security-Policy`             |
| `production` | `report-only`         | `report-only`  | `Content-Security-Policy-Report-Only` |
| other        | unset                 | `report-only`  | `Content-Security-Policy-Report-Only` |
| other        | `enforce`             | `enforce`      | `Content-Security-Policy`             |
| other        | `report-only`         | `report-only`  | `Content-Security-Policy-Report-Only` |

An explicit `CSP_MODE` always wins; production is only the tiebreaker when the
value is unset. `CSP_MODE=report-only` is therefore the documented rollback
lever (see [docs/security-csp.md](security-csp.md)) and does **not** require a
schema or code change.

`CSP_MODE` is validated by the server's Varlock schema. It accepts `enforce` or
`report-only` and defaults to `report-only`; any other value fails startup
instead of silently falling back. Because it is read at boot, changing it
requires a server restart.

When the effective mode is `enforce`, the response also advertises the
violation sink via a `report-to /api/security/csp-report` directive and a
matching `Report-To` JSON-document header. Report-only responses stay
destination-free so a rolled-back deployment stops reporting.

## 4. Configuration

| Variable   | Values                    | Schema default | Effective production default | Effect                                        |
| ---------- | ------------------------- | -------------- | ---------------------------- | --------------------------------------------- |
| `CSP_MODE` | `enforce` / `report-only` | `report-only`  | `enforce` (unless explicit)  | Which CSP header is emitted                   |
| `NODE_ENV` | `development` / …         | `development`  | —                            | Enables `'unsafe-eval'` only in `development` |

Both are read from the schema-validated `ENV` at boot (`apps/server/.env.schema`
→ `apps/server/src/env.ts`, generated by `varlock codegen` and never edited by
hand). `NODE_ENV` defaults to `development`; the effective CSP mode additionally
depends on whether `CSP_MODE` was explicitly set (see §3). Changing either
requires a server restart.

## 5. Out of scope / follow-ups

- **Request body-size enforcement** — done in #126: `bodyLimitMiddleware`
  (`apps/server/src/body-limit.ts`) rejects bodies over `API_MAX_BODY_BYTES`
  (default 1 MiB) with `413`. The CSP sink keeps its tighter 16 KiB inline cap
  from #127.
- **Per-route header overrides** — headers are global for now.

## 6. Violation reporting

When CSP is enforced, both the server and the web document (nginx, see
[docs/security-csp.md](security-csp.md#web-document)) advertise the
`csp-endpoint` reporting group (`report-to csp-endpoint` with the
`Reporting-Endpoints` and legacy `Report-To` headers) plus a `report-uri`
fallback for browsers without `report-to` support. Reports are accepted at
`POST /api/security/csp-report`.

Accepted payloads: `application/csp-report` (legacy `report-uri` envelope) and
`application/reports+json` (Reporting API batch; non-`csp-violation` entries are
skipped and camelCase bodies are mapped onto the legacy field names). Everything
else is rejected with `415`. The route is mounted after CORS, so cross-origin
Reporting API uploads from the web origin pass the preflight. The route:

- caps the body at **16 KiB** inline (`413` beyond that — there is no upstream
  body-size middleware);
- requires an `Origin` header that exactly equals `CORS_ORIGIN`, otherwise
  `400` (reported as `csp.report.rejected.origin-missing` /
  `origin-mismatch`, logging only the header length);
- applies a strict field allow-list — `document-uri`, `blocked-uri`,
  `violated-directive`, `effective-directive`, `original-policy`, `source-file`,
  `line-number`, `column-number`, `disposition`. Unknown fields are rejected
  with `400`; `referrer`, `sample`, `script-sample` and `style-sample` are
  dropped silently, as is `status-code`;
- rate-limits per verified origin at **60/min** (denied requests are
  not counted and no row is inserted);
- returns **204** on success so browsers stop retrying.

**No raw report value is ever logged or stored.** URIs are reduced to a host and
at most the first two path segments; the `original-policy` literal is stored as
an 8-byte blake2b hash; log lines carry counts and lengths only. One row per
accepted violation is appended to `csp_violation_event` (see
`packages/db/src/migrations/20261014120000_csp_violation_event/`):

| Column                                           | Notes                                 |
| ------------------------------------------------ | ------------------------------------- |
| `id`                                             | `bigserial` primary key               |
| `occurred_at`                                    | `timestamptz`, defaults to `now()`    |
| `csp_mode_at_emit`                               | `report-only` / `enforce`             |
| `document_uri_host` / `document_uri_path_prefix` | host required, path-prefix optional   |
| `violated_directive` / `effective_directive`     | directive names                       |
| `blocked_uri_host` / `blocked_uri_path_prefix`   | may be null (`inline`, `eval`, …)     |
| `source_file` / `source_line` / `source_column`  | capped scalars                        |
| `original_policy_hash`                           | 8-byte blake2b of the policy literal  |
| `disposition`                                    | `enforce` / `report`                  |
| `correlation_id`                                 | links the row to the request log line |

The table is metadata-only with no foreign keys and no personal identifiers, so
it survives erasure. Retention follows the platform log-retention policy; prune
old rows with the operator runbook when the table grows.

Operator rollback of an enforced deployment is documented in
[docs/security-csp.md](security-csp.md).
