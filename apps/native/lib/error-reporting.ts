import { errorReportingConfig } from "@openvalens/observability/error-reporting";
import { initNativeErrorReporting } from "@openvalens/observability/providers/sentry-native";

import { ENV } from "@/src/env";

/**
 * Optional Sentry error reporting for the mobile app (Issue #54). Off unless
 * `EXPO_PUBLIC_SENTRY_DSN` was set at build time; see the adapter for what is
 * sent (JavaScript errors only, scrubbed).
 */
export function initErrorReporting(): void {
  const config = errorReportingConfig({
    dsn: ENV.EXPO_PUBLIC_SENTRY_DSN,
    environment: ENV.EXPO_PUBLIC_SENTRY_ENVIRONMENT,
    release: ENV.EXPO_PUBLIC_SENTRY_RELEASE,
    fallbackEnvironment: ENV.NODE_ENV,
  });
  if (config) initNativeErrorReporting(config);
}
