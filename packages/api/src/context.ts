import type { Session } from "@openhealth/auth";
import type { AuthzRequestContext } from "@openhealth/auth/authz/context";
import type { Database } from "@openhealth/db";

/**
 * Structural view of the inbound request that the authz guards need.
 *
 * `@openhealth/auth/authz/*` guards accept any object shaped like
 * `{ req: { raw: { headers: Headers } } }`, and Hono's `Context` satisfies it,
 * so the server can hand its Hono context straight through.
 */
export type ApiRequestContext = AuthzRequestContext;

/**
 * Optional integration capability flags surfaced by the readiness probe.
 *
 * Each flag is `true` only when the env var its capability requires is present
 * on the server; the server derives them (it owns the env) and hands them to
 * this package through the oRPC context.
 */
export type CapabilityFlags = {
  telegram: boolean;
  anthropic: boolean;
  resend: boolean;
  mobilePairing: boolean;
};

export type Context = {
  session: Session | null;
  db: Database;
  /** Resolved `x-correlation-id` → `x-request-id` → UUID. */
  correlationId: string;
  /**
   * Expected bearer token for `cronProcedure`.
   *
   * Provided by the server context (from `ENV.CRON_SECRET`) so this package
   * never reads server environment directly.
   */
  cronSecret: string;
  /**
   * `true` when `BETTER_AUTH_SECRET` is present and meets the minimum length.
   *
   * Derived by the server so the readiness probe can report secret presence
   * without this package reading server environment directly.
   */
  betterAuthSecretConfigured: boolean;
  /** Env-derived capability flags for the readiness probe. */
  capabilities: CapabilityFlags;
  /** The raw Hono context, used by authz guards and cron auth. */
  honoContext: ApiRequestContext;
};
