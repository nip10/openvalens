// @ts-check
const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

/**
 * Hardware the app can use but does not need (#524). Google Play filters out
 * every device that lacks a feature the manifest requires, and a permission
 * alone implies a required feature: in 1.2.0 the Bluetooth stack's
 * `BLUETOOTH`/`BLUETOOTH_ADMIN` and its location permissions (BLE scans need
 * them on Android 11 and lower) made Play require Bluetooth and location
 * hardware, dropping phones and tablets that 1.1.0 supported.
 *
 * Declaring each feature with `android:required="false"` overrides the
 * implied requirement. `tools:replace` wins over any library manifest that
 * declares one of them as required. Settings › Devices says Bluetooth isn't
 * available on a device without it instead of starting a scan.
 */
const OPTIONAL_FEATURES = Object.freeze([
  "android.hardware.bluetooth",
  "android.hardware.bluetooth_le",
  "android.hardware.location",
  "android.hardware.location.gps",
  "android.hardware.location.network",
]);

/**
 * @param {import("expo/config-plugins").AndroidConfig.Manifest.AndroidManifest} manifest
 * @param {readonly string[]} [features]
 */
function withOptionalFeatures(manifest, features = OPTIONAL_FEATURES) {
  AndroidConfig.Manifest.ensureToolsAvailable(manifest);
  const existing = manifest.manifest["uses-feature"] ?? [];
  const others = existing.filter((entry) => !features.includes(entry.$["android:name"] ?? ""));
  manifest.manifest["uses-feature"] = [
    ...others,
    ...features.map((name) => ({
      $: {
        "android:name": name,
        "android:required": "false",
        "tools:replace": "android:required",
      },
    })),
  ];
  return manifest;
}

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withOptionalHardware = (config) =>
  withAndroidManifest(config, (mod) => {
    mod.modResults = withOptionalFeatures(mod.modResults);
    return mod;
  });

module.exports = withOptionalHardware;
module.exports.OPTIONAL_FEATURES = OPTIONAL_FEATURES;
module.exports.withOptionalFeatures = withOptionalFeatures;
