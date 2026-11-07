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

  test("the iOS app is iPhone only (no iPad screenshots needed in App Store Connect)", () => {
    expect(withBuildEnv(base, {}).ios?.supportsTablet).toBe(false);
  });

  test("configures BLE with a truthful iOS purpose and no background/location assertion", () => {
    const plugin = base.plugins?.find(
      (entry) => Array.isArray(entry) && entry[0] === "@config-plugins/react-native-ble-plx",
    );
    expect(plugin).toEqual([
      "@config-plugins/react-native-ble-plx",
      {
        bluetoothAlwaysPermission:
          "OpenValens uses Bluetooth to connect to compatible health devices when you choose to pair them.",
      },
    ]);
    expect(base.ios?.infoPlist?.NSBluetoothAlwaysUsageDescription).toBeUndefined();
    expect(withBuildEnv(base, {}).plugins).toEqual(base.plugins);
  });

  test("HealthKit sets both purpose strings (App Store rejects a build missing either, ITMS-90683)", () => {
    const healthkit = base.plugins?.find(
      (p) => Array.isArray(p) && p[0] === "@kingstinct/react-native-healthkit",
    ) as [string, Record<string, unknown>] | undefined;
    expect(typeof healthkit?.[1].NSHealthShareUsageDescription).toBe("string");
    expect(typeof healthkit?.[1].NSHealthUpdateUsageDescription).toBe("string");
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

  test("EXPO_PUBLIC_ALLOW_LOCAL_HTTP turns on Android cleartext for a test build only", () => {
    const buildProps = (config: ExpoConfig) =>
      config.plugins?.find((p) => Array.isArray(p) && p[0] === "expo-build-properties");
    expect(withBuildEnv(base, {}).plugins).toEqual(base.plugins);
    expect(withBuildEnv(base, { EXPO_PUBLIC_ALLOW_LOCAL_HTTP: "false" }).plugins).toEqual(
      base.plugins,
    );
    const config = withBuildEnv(base, { EXPO_PUBLIC_ALLOW_LOCAL_HTTP: "true" });
    expect(buildProps(config)).toEqual([
      "expo-build-properties",
      {
        android: {
          minSdkVersion: 26,
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
          usesCleartextTraffic: true,
        },
      },
    ]);
    expect(config.plugins?.length).toBe(base.plugins?.length);
  });
});
