# Observability & security headers

Last updated: 2026-09-29

> Implemented in Issue #9 (PHI-safe structured logger + correlation id) and
> Issue #12 (CSP + security headers). Source of truth for the header posture is
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
  passes `NODE_ENV === "development"`, so production never allows eval.
- `connect-src` allowlists the two external integrations used by the platform:
  Resend (`api.resend.com`) and Telegram (`api.telegram.org`).
- `frame-ancestors 'none'` matches `X-Frame-Options: DENY`.

## 3. CSP rollout (staged)

The server defaults to **report-only** so a policy change cannot break a live
client before it is validated:

1. Deploy with the default (`CSP_MODE` unset → `report-only`). Responses carry
   `Content-Security-Policy-Report-Only`.
2. Monitor for violations (browser devtools/console, or the future report
   endpoint — see §5).
3. When the report is clean, set `CSP_MODE=enforce`. Responses then carry the
   enforced `Content-Security-Policy`.

`CSP_MODE` is read directly from `process.env` and accepts `enforce` or
`report-only`; any other value (including unset) falls back to `report-only`.

## 4. Configuration

| Variable   | Values                    | Default       | Effect                                        |
| ---------- | ------------------------- | ------------- | --------------------------------------------- |
| `CSP_MODE` | `enforce` / `report-only` | `report-only` | Which CSP header is emitted                   |
| `NODE_ENV` | `development` / …         | `development` | Enables `'unsafe-eval'` only in `development` |

Both are read from `process.env` directly; no new env vars are introduced and
the varlock-generated `env.ts` is never edited.

## 5. Out of scope / follow-ups

- **CSP report-uri endpoint** — the report-only header is emitted without a
  reporting destination. Adding a collector is a follow-up.
- **Request body-size enforcement** — anchovy caps `proxyClientMaxBodySize` at
  `5_000_000` bytes. Hono does not enforce this by default and Issue #12 does
  not add a 413 short-circuit; treat it as a follow-up.
- **Per-route header overrides** — headers are global for now.
