/**
 * Sanitized Varlock load-error boundary (Issue #58 security follow-up).
 *
 * Varlock 1.18.0 `auto-load` behaves as follows on a schema/validation failure:
 *
 *  1. It writes the native **masked** stderr (values are truncated, e.g.
 *     `SY▒▒▒▒▒`), which is safe.
 *  2. If `globalThis._varlockOnLoadError` is a function, it invokes it
 *     synchronously; a thrown error is swallowed and the process exits with the
 *     CLI exit code.
 *  3. Otherwise, when `_VARLOCK_THROW_ON_LOAD_ERROR=1` is set, it throws a
 *     `VarlockExecError` whose **enumerable** `stdout` property holds the raw
 *     `varlock load --format json-full` JSON — including every resolved value,
 *     sensitive or not. Bun's uncaught-error printer then emits that raw JSON.
 *
 * Registering a synchronous hook replaces path (3) with a clean non-zero exit
 * while preserving the native masked stderr. Varlock does pass the raw error
 * (including `error.stdout`) and a partial-env argument to the hook; this hook
 * never inspects, logs, returns or stores that raw stdout or partial-env data —
 * it derives only known key names from the already-masked `error.stderr` plus a
 * fixed documentation link.
 *
 * This is a small local declaration of the (untyped) hook because Varlock does
 * not export the hook type at the pinned version; re-review on library upgrade.
 */

import { writeSync } from "node:fs";

/** Configuration help linked from every sanitized load error. */
export const VARLOCK_LOAD_ERROR_DOCS_LINK =
  "https://github.com/nip10/openvalens/blob/main/CONTRIBUTING.md#file-based-secrets";

/**
 * Known environment key names that may be named in a sanitized error. Mirrors
 * `apps/server/.env.schema` (the database profile is a subset). Keys outside
 * this allowlist are never echoed.
 */
export const VARLOCK_ERROR_KEY_ALLOWLIST = [
  "NODE_ENV",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "CORS_ORIGIN",
  "DATABASE_URL",
  "CRON_SECRET",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "EMAIL_REPLY_TO",
  "EMAIL_AUDIT_BCC",
  "EMAIL_DRY_RUN",
  "AUTH_DEV_MAGIC_LINK_CONSOLE",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_CONNECT_TOKEN_TTL_SECONDS",
  "TELEGRAM_API_BASE_URL",
  "ANTHROPIC_API_KEY",
  "AI_MODEL",
  "AI_RATE_LIMIT_PER_MINUTE",
] as const;

type VarlockLoadError = {
  exitCode?: number;
  stderr?: string;
};

type VarlockOnLoadError = (error: VarlockLoadError, partialEnv?: unknown) => unknown;

/**
 * Builds a bounded error message: allowlisted key names present in the native
 * masked stderr, plus the docs link. Never includes values, paths, causes or the
 * raw JSON.
 */
export function safeVarlockErrorMessage(maskedStderr: string): string {
  const keys = VARLOCK_ERROR_KEY_ALLOWLIST.filter((key) => maskedStderr.includes(key));
  const scope = keys.length > 0 ? ` for: ${keys.join(", ")}` : "";
  return (
    `Varlock environment validation failed${scope}. ` +
    `Configure secrets before deploying: ${VARLOCK_LOAD_ERROR_DOCS_LINK}`
  );
}

/**
 * Installs the synchronous hook once. Existing app-owned hooks are preserved
 * (never wrapped or called), and this never monkey-patches stdout/stderr.
 */
export function installVarlockSafeErrorHook(): void {
  const scope = globalThis as typeof globalThis & {
    _varlockOnLoadError?: VarlockOnLoadError;
  };
  if (typeof scope._varlockOnLoadError === "function") return;

  scope._varlockOnLoadError = (error) => {
    const maskedStderr = typeof error?.stderr === "string" ? error.stderr : "";
    const message = safeVarlockErrorMessage(maskedStderr);
    // The native masked stderr is already written by auto-load. Emit only the
    // bounded keys+docs line synchronously (process.exit follows immediately).
    try {
      writeSync(2, `${message}\n`);
    } catch {
      // No usable stderr; the non-zero exit still fails closed.
    }
    // A synchronous throw is swallowed by auto-load, which then exits non-zero.
    // Returning a thenable would make auto-load rethrow the raw VarlockExecError.
    throw new Error(message);
  };
}
