import type { ErrorReportingConfig } from "@openvalens/observability";
import {
  captureServerError,
  initServerErrorReporting,
} from "@openvalens/observability/providers/sentry-server";
import { ORPCError } from "@orpc/server";

/**
 * Optional Sentry error reporting for the server (Issue #54). Off unless
 * `SENTRY_DSN` is set. Client errors (validation, auth, not found) are never
 * reported; see the adapter for what is sent.
 */

let enabled = false;

export function initErrorReporting(config: ErrorReportingConfig | null): boolean {
  if (!config || enabled) return enabled;
  initServerErrorReporting(config);
  enabled = true;
  return enabled;
}

/** True for failures worth reporting: not client errors such as validation or auth. */
export function isReportable(error: unknown): boolean {
  if (error instanceof ORPCError) return error.status >= 500;
  return true;
}

/** Reports an unexpected request failure when reporting is on. */
export function reportError(error: unknown): void {
  if (enabled && isReportable(error)) captureServerError(error);
}
