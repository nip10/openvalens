import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  test("Android release builds run R8 with optimisation and our keep rules (#522)", () => {
    const r8 = require("./plugins/android-r8") as {
      useOptimizeRules: (gradle: string) => string;
      withRulesBlock: (contents: string, rules: string) => string;
    };
    expect(base.plugins).toContain("./plugins/android-r8");
    expect(
      base.plugins?.find((p) => Array.isArray(p) && p[0] === "expo-build-properties"),
    ).toMatchObject([
      "expo-build-properties",
      {
        android: { enableMinifyInReleaseBuilds: true, enableShrinkResourcesInReleaseBuilds: true },
      },
    ]);

    const gradle =
      'proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"';
    const optimized =
      'proguardFiles getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro"';
    expect(r8.useOptimizeRules(gradle)).toBe(optimized);
    expect(r8.useOptimizeRules(optimized)).toBe(optimized);
    expect(() => r8.useOptimizeRules("proguardFiles 'custom.pro'")).toThrow(/android-r8/);

    // A second prebuild replaces the block instead of adding another one.
    const once = r8.withRulesBlock("# template\n", "-keep class a.** { *; }\n");
    const twice = r8.withRulesBlock(once, "-keep class b.** { *; }");
    expect(twice).toBe(
      "# template\n\n# @generated begin openvalens-android-r8\n-keep class b.** { *; }\n# @generated end openvalens-android-r8\n",
    );

    const rules = readFileSync(
      join(import.meta.dir, "plugins/android-r8/proguard-rules.pro"),
      "utf8",
    );
    expect(rules).toContain(
      "-keep class * implements expo.modules.apploader.HeadlessAppLoader { <init>(); }",
    );
    expect(rules).toContain("-keep class com.bleplx.** { *; }");
    expect(rules).toContain("-keep class com.reactnativeandroidwidget.** { *; }");
  });

  test("the home-screen widget (#449) is home screen only and shares nothing with a widget process", () => {
    // No App Group (or keychain group) for the app or the iOS widget target.
    expect(base.ios?.entitlements).toBeUndefined();
    const target = require("./targets/quick-log-widget/expo-target.config.js") as {
      type: string;
      entitlements?: unknown;
    };
    expect(target.type).toBe("widget");
    expect(target.entitlements).toBeUndefined();
    expect(base.plugins).toContain("@bacons/apple-targets");
    expect(base.plugins).toContain("./plugins/home-widget");
    // iOS: home-screen family only, no lock-screen (accessory) widgets.
    const swift = readFileSync(
      join(import.meta.dir, "targets/quick-log-widget/QuickLogWidget.swift"),
      "utf8",
    );
    expect(swift).toContain(".supportedFamilies([.systemMedium])");
    expect(swift).not.toMatch(/\.accessory[A-Z]/);
    // Android: home screen, opted out of the lock screen.
    const android = base.plugins?.find(
      (entry) => Array.isArray(entry) && entry[0] === "react-native-android-widget",
    ) as [string, { widgets: { name: string; widgetCategory: string }[] }];
    expect(android[1].widgets.map((widget) => [widget.name, widget.widgetCategory])).toEqual([
      ["QuickLog", "home_screen|not_keyguard"],
    ]);
  });

  test("the Android widget's receiver records its own taps and keeps its class name (#505)", () => {
    const plugin = require("./plugins/home-widget") as {
      widgetReceiverJava: (androidPackage: string) => string;
    };
    const java = plugin.widgetReceiverJava(base.android?.package ?? "");
    // The library's class, so widgets already on a home screen stay bound to it…
    expect(java).toContain("package com.openvalens.app.widget;");
    expect(java).toContain("public class QuickLog extends TapRecordingWidgetProvider");
    // …made to extend the module's receiver, which records the tap before it opens the app.
    const kotlin = readFileSync(
      join(
        import.meta.dir,
        "modules/home-widget-tap/android/src/main/java/expo/modules/homewidgettap/TapRecordingWidgetProvider.kt",
      ),
      "utf8",
    );
    expect(kotlin).toContain("package expo.modules.homewidgettap");
    expect(kotlin).toContain("open class TapRecordingWidgetProvider : RNWidgetProvider()");
    expect(java).toContain("import expo.modules.homewidgettap.TapRecordingWidgetProvider;");
  });
});
