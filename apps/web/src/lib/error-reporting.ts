import { errorReportingConfig } from "@openvalens/observability/error-reporting";
import {
  captureWebError,
  initWebErrorReporting,
} from "@openvalens/observability/providers/sentry-web";

import { ENV } from "../env";

/**
 * Optional Sentry error reporting for the web app (Issue #54). Off unless
 * `VITE_SENTRY_DSN` was set at build time; see the adapter for what is sent.
 */

let enabled = false;

export function initErrorReporting(): void {
  const config = errorReportingConfig({
    dsn: ENV.VITE_SENTRY_DSN,
    environment: ENV.VITE_SENTRY_ENVIRONMENT,
    release: ENV.VITE_SENTRY_RELEASE,
    fallbackEnvironment: ENV.NODE_ENV,
  });
  if (!config) return;
  initWebErrorReporting(config);
  enabled = true;
}

/** Reports an error caught by the router; a no-op while reporting is off. */
export function reportError(error: unknown): void {
  if (enabled) captureWebError(error);
}
