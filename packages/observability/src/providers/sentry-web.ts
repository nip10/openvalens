import * as Sentry from "@sentry/react";

import { dropBreadcrumb, scrubErrorEvent, type ErrorReportingConfig } from "../error-reporting";

/**
 * Sentry adapter for the web app (Issue #54). Default integrations are off:
 * they would record fetch URLs, console output, clicks and page URLs as
 * breadcrumbs. Only uncaught errors, unhandled rejections and errors passed to
 * {@link captureWebError} are sent, each reduced by `scrubErrorEvent`. No
 * tracing or session replay.
 */
export function initWebErrorReporting(config: ErrorReportingConfig): void {
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
      Sentry.globalHandlersIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.dedupeIntegration(),
    ],
    maxBreadcrumbs: 0,
    beforeBreadcrumb: dropBreadcrumb,
    beforeSend: scrubErrorEvent,
  });
}

export function captureWebError(error: unknown): void {
  Sentry.captureException(error);
}
