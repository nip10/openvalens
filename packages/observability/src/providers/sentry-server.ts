import * as Sentry from "@sentry/bun";

import { dropBreadcrumb, scrubErrorEvent, type ErrorReportingConfig } from "../error-reporting";

/**
 * Sentry adapter for the Bun server (Issue #54). Default integrations are off:
 * they would add HTTP, console and module breadcrumbs and request data. Only
 * uncaught exceptions, unhandled rejections and errors the server passes to
 * {@link captureServerError} are sent, each reduced by `scrubErrorEvent`.
 * No tracing.
 */
export function initServerErrorReporting(config: ErrorReportingConfig): void {
  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    // Collect no user, cookie, header, body or query data at all.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    defaultIntegrations: false,
    integrations: [
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.dedupeIntegration(),
    ],
    maxBreadcrumbs: 0,
    beforeBreadcrumb: dropBreadcrumb,
    beforeSend: scrubErrorEvent,
  });
}

export function captureServerError(error: unknown): void {
  Sentry.captureException(error);
}
