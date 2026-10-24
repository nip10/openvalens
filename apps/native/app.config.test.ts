import { describe, expect, test } from "bun:test";
import type { ExpoConfig } from "expo/config";

import appJson from "./app.json";
import { withBuildEnv } from "./app.config";

const base = appJson.expo as unknown as ExpoConfig;
const PROJECT_ID = "00000000-0000-4000-8000-000000000000";

describe("app.config.ts", () => {
  test("without build env the config is app.json and has no project id", () => {
    const config = withBuildEnv(base, {});
    expect(config).toEqual({ ...base, extra: {} });
    expect(config.extra?.eas?.projectId).toBeUndefined();
    expect(config.android?.googleServicesFile).toBeUndefined();
  });

  test("sets extra.eas.projectId from EXPO_PUBLIC_EAS_PROJECT_ID", () => {
    const config = withBuildEnv(base, { EXPO_PUBLIC_EAS_PROJECT_ID: ` ${PROJECT_ID}\n` });
    expect(config.extra?.eas?.projectId).toBe(PROJECT_ID);
    expect(config.plugins).toEqual(base.plugins);
    expect(config.ios).toEqual(base.ios);
  });

  test("a blank project id is treated as unset", () => {
    expect(withBuildEnv(base, { EXPO_PUBLIC_EAS_PROJECT_ID: "  " }).extra?.eas).toBeUndefined();
  });

  test("GOOGLE_SERVICES_JSON sets the Android FCM file and keeps the rest of android", () => {
    const config = withBuildEnv(base, { GOOGLE_SERVICES_JSON: "./google-services.json" });
    expect(config.android?.googleServicesFile).toBe("./google-services.json");
    expect(config.android?.package).toBe("com.openvalens.app");
    expect(config.android?.permissions).toEqual(base.android?.permissions);
  });
});
