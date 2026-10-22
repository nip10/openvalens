import * as Sentry from "@sentry/react-native";

import { dropBreadcrumb, scrubErrorEvent, type ErrorReportingConfig } from "../error-reporting";

/**
 * Sentry adapter for the mobile app (Issue #54). JS-only: the native SDK is
 * never started, so there is no native crash capture, session tracking or
 * screenshot. Default integrations are off: they would record fetch URLs,
 * console output, touches and navigation as breadcrumbs and device details as
 * context. Every event is reduced by `scrubErrorEvent`. No tracing or replay.
 */
export function initNativeErrorReporting(config: ErrorReportingConfig): void {
  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    enableNative: false,
    autoInitializeNativeSdk: false,
    enableAutoSessionTracking: false,
    sendDefaultPii: false,
    defaultIntegrations: false,
    integrations: [Sentry.reactNativeErrorHandlersIntegration()],
    maxBreadcrumbs: 0,
    beforeBreadcrumb: dropBreadcrumb,
    beforeSend: scrubErrorEvent,
  });
}
