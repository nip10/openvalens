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
 * Both are optional. See docs/self-hosting/mobile-app.md#push-notifications.
 */
export type BuildEnv = {
  EXPO_PUBLIC_EAS_PROJECT_ID?: string;
  GOOGLE_SERVICES_JSON?: string;
};

export function withBuildEnv(config: ConfigContext["config"], env: BuildEnv): ExpoConfig {
  const projectId = env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  const googleServicesFile = env.GOOGLE_SERVICES_JSON?.trim();
  const extra = config.extra ?? {};
  return {
    ...config,
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
  });
