/**
 * Operator-set `CSP_MODE` capture (Issue #127).
 *
 * This module MUST be evaluated before `./env.server.ts`. Varlock's
 * `auto-load` injects the schema default (`report-only`) into `process.env` for
 * an unset `CSP_MODE`, which makes an operator-set `report-only` in production
 * indistinguishable from the runtime default after the fact. Snapshotting the
 * value here — before Varlock runs — is the only way `resolveCspMode` can honour
 * "an explicit `CSP_MODE` always wins".
 *
 * It intentionally imports nothing so a transitive dependency cannot pull
 * Varlock ahead of it. `apps/server/src/index.ts` imports it as its very first
 * line and `apps/server/src/csp-mode-capture.test.ts` locks the ordering in.
 */

/** Same enum the generated `ENV.CSP_MODE` uses, or `undefined` when unset. */
export type ExplicitCspMode = "enforce" | "report-only" | undefined;

/**
 * Snapshot of `process.env.CSP_MODE` taken at module-eval time, before Varlock
 * injects the schema default. An unrecognised value yields `undefined` (the
 * schema rejects bad values and fails startup before this matters).
 */
export const EXPLICIT_CSP_MODE: ExplicitCspMode =
  process.env.CSP_MODE === "enforce" || process.env.CSP_MODE === "report-only"
    ? process.env.CSP_MODE
    : undefined;
