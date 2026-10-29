import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Build-time additions to `app.json` (#243). Expo reads `app.json` first and
 * passes it here as `config`; everything not set below comes from there.
 *
 * - `EXPO_PUBLIC_EAS_PROJECT_ID`: the EAS project UUID. Push registration needs
 *   it (`getExpoPushTokenAsync({ projectId })`); without it the app shows push
 *   as unavailable. It is an identifier, not a secret.
 * - `GOOGLE_SERVICES_JSON`: path to the Firebase `google-services.json`, which
 *   Android needs to receive FCM pushes.
 *
 * - `EXPO_PUBLIC_ALLOW_LOCAL_HTTP=true`: a test build (#302) that may use plain
 *   HTTP to a local server; on Android that needs cleartext traffic, which
 *   `expo-build-properties` turns on. Never set for a store build.
 *
 * All are optional. See docs/self-hosting/mobile-app.md#push-notifications
 * and docs/mobile/e2e.md.
 */
export type BuildEnv = {
  EXPO_PUBLIC_EAS_PROJECT_ID?: string;
  GOOGLE_SERVICES_JSON?: string;
  EXPO_PUBLIC_ALLOW_LOCAL_HTTP?: string;
};

type PluginEntry = NonNullable<ExpoConfig["plugins"]>[number];

/** Adds `android.usesCleartextTraffic` to the `expo-build-properties` entry. */
function withCleartext(plugins: ExpoConfig["plugins"]): ExpoConfig["plugins"] {
  return (plugins ?? []).map((entry: PluginEntry): PluginEntry => {
    if (!Array.isArray(entry) || entry[0] !== "expo-build-properties") return entry;
    const props = (entry[1] ?? {}) as { android?: Record<string, unknown> };
    return [entry[0], { ...props, android: { ...props.android, usesCleartextTraffic: true } }];
  });
}

export function withBuildEnv(config: ConfigContext["config"], env: BuildEnv): ExpoConfig {
  const projectId = env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  const googleServicesFile = env.GOOGLE_SERVICES_JSON?.trim();
  const extra = config.extra ?? {};
  const allowLocalHttp = env.EXPO_PUBLIC_ALLOW_LOCAL_HTTP?.trim() === "true";
  return {
    ...config,
    ...(allowLocalHttp ? { plugins: withCleartext(config.plugins) } : {}),
    name: config.name ?? "OpenValens",
    slug: config.slug ?? "openvalens",
    ...(googleServicesFile ? { android: { ...config.android, googleServicesFile } } : {}),
    extra: projectId ? { ...extra, eas: { ...extra.eas, projectId } } : extra,
  };
}

export default ({ config }: ConfigContext): ExpoConfig =>
  withBuildEnv(config, {
    EXPO_PUBLIC_EAS_PROJECT_ID: process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
    GOOGLE_SERVICES_JSON: process.env.GOOGLE_SERVICES_JSON,
    EXPO_PUBLIC_ALLOW_LOCAL_HTTP: process.env.EXPO_PUBLIC_ALLOW_LOCAL_HTTP,
  });
