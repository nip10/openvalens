# CSP enforcement runbook — Issue #127

Last updated: 2026-10-14

> Operator runbook for enforcing Content Security Policy in production and for
> rolling back to report-only when a supported flow breaks under enforcement.
> Posture and configuration reference:
> [docs/observability.md §3 and §6](observability.md#3-csp-rollout-staged).

## Defaults and precedence

The effective CSP mode is `resolveCspMode(NODE_ENV, CSP_MODE)`:

- **An explicit `CSP_MODE` always wins.** `CSP_MODE=report-only` keeps the
  report-only header even in production; `CSP_MODE=enforce` enforces it
  everywhere.
- **Otherwise, `NODE_ENV=production` defaults to `enforce`** and every other
  environment (including the schema default) is `report-only`.

So a production deployment that does not set `CSP_MODE` boots under
enforcement. The value is read once at boot — changing it requires a restart
(a redeploy).

## Web document

The SPA is served by nginx in the `web` container, not by the Hono server, so it
carries its own copy of the policy. `scripts/render-web-security-headers.ts`
renders it at image build time from the same `buildSecurityHeaders` source, with
two differences: the API origin (`VITE_SERVER_URL`) is added to `connect-src`
(web and API are split-origin), and reports go to
`${VITE_SERVER_URL}/api/security/csp-report`. Changing `VITE_SERVER_URL`
therefore requires rebuilding the web image.

The web container reads `CSP_MODE` at start
(`apps/web/docker-entrypoint.d/40-csp-mode.sh`): unset or `enforce` emits the
enforced policy, `report-only` the report-only header, and any other value stops
the container. The web image is production-only, so unset means `enforce`.

## Rollback: enforce → report-only

Use this when login, invitation acceptance, the app shell or asset connections
break under enforcement. It is an explicit, operator-gated change — there is no
automatic fallback.

1. **Change the environment.** Set `CSP_MODE=report-only` on **both** the
   server and the web service in the platform (do **not** unset it — unsetting
   it re-selects the production `enforce` default). Both values are validated,
   so `report-only` is the only accepted rollback value. A break in the browser
   (login, invitation, app shell) is almost always the web document's policy.
   On the self-host Compose stack one `CSP_MODE=report-only` line in
   `deploy/.env` sets both, followed by `deploy/setup.sh upgrade`
   ([Configuration](self-hosting/configuration.md#content-security-policy)).
2. **Redeploy / restart both services** so the new value is picked up. Confirm
   each response now carries `Content-Security-Policy-Report-Only` instead of
   `Content-Security-Policy`:
   ```bash
   curl -sS -D - -o /dev/null https://<web-domain>/ | grep -i 'content-security-policy'
   curl -sS -D - -o /dev/null https://<api-domain>/ | grep -i 'content-security-policy'
   ```
   An enforced deployment also sends a `Report-To` header; a report-only
   deployment does not.
3. **Validate** that the affected flow works again (sign in, accept an
   invitation, load the app shell) and that no enforced policy blocks a
   legitimate origin. Watch for the rejection logs
   `csp.report.rejected.origin-missing` / `origin-mismatch` — a sustained
   `origin-missing` usually means a reverse proxy is stripping `Origin`.

## Re-enforcing after a rollback

Fix the underlying incompatibility (for example, allowlist a legitimate origin
in `packages/observability/src/security-headers.ts`, then rebuild the web image
so its rendered policy picks it up) and re-test under
enforcement. Do **not** loosen `script-src` beyond `'unsafe-inline'`, and never
add `'unsafe-eval'` in production. Once the flow is verified, remove the
`CSP_MODE=report-only` override (or set `CSP_MODE=enforce`) and redeploy.

## Notes

- Reports are collected at `POST /api/security/csp-report` and stored in
  `csp_violation_event`; see
  [docs/observability.md §6](observability.md#6-violation-reporting). Reports
  are metadata-only and never contain PHI or secrets.
- The migration for the sink is applied by the normal, explicitly approved
  `bun run db:migrate`; this runbook does not run migrations.
