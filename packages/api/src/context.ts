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
  /** The raw Hono context, used by authz guards and cron auth. */
  honoContext: ApiRequestContext;
};
