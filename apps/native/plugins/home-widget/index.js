// @ts-check
const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod, withFinalizedMod } = require("expo/config-plugins");

/**
 * The Android home-screen widget's additions (#449, #505) to what
 * `react-native-android-widget` (its own entry in app.json) sets up:
 *
 * - its picker name and description, in every shipped language. The library
 *   points the receiver at `@string/home_widget_name` and
 *   `@string/home_widget_description`; this writes those strings from
 *   `strings.json`, which `bun run widget:strings` generates from the Lingui
 *   catalogs. Any Portuguese goes to `values-pt`, as the app maps every
 *   Portuguese to pt-PT;
 * - its receiver records water and "Taken" taps (`modules/home-widget-tap`).
 */

/** @type {Record<string, string>} Lingui locale → Android resource folder. */
const FOLDERS = { en: "values", "pt-PT": "values-pt" };

/** @param {string} value */
function escapeAndroid(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"');
}

/** @param {{ widget_name: string; widget_description: string }} strings */
function stringsXml(strings) {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<!-- Generated at prebuild from plugins/home-widget/strings.json. -->",
    "<resources>",
    `  <string name="home_widget_name">${escapeAndroid(strings.widget_name)}</string>`,
    `  <string name="home_widget_description">${escapeAndroid(strings.widget_description)}</string>`,
    "</resources>",
    "",
  ].join("\n");
}

/** The widget's name in app.json (`react-native-android-widget`). */
const WIDGET_NAME = "QuickLog";

/**
 * The widget's receiver class, as the library generates it at prebuild
 * (`<package>.widget.QuickLog`), made to extend the one in
 * `modules/home-widget-tap` instead, which records water and "Taken" taps
 * (#505). Same class name, so widgets already placed keep working.
 *
 * @param {string} androidPackage
 */
function widgetReceiverJava(androidPackage) {
  return [
    `package ${androidPackage}.widget;`,
    "",
    "// Generated at prebuild by plugins/home-widget (#505).",
    "import expo.modules.homewidgettap.TapRecordingWidgetProvider;",
    "",
    `public class ${WIDGET_NAME} extends TapRecordingWidgetProvider {`,
    "}",
    "",
  ].join("\n");
}

/**
 * Rewrites the receiver class after every other mod, so after the library's
 * own (a dangerous mod) wrote it, whatever the order in app.json.
 *
 * @type {import("expo/config-plugins").ConfigPlugin}
 */
const withHomeWidgetTapReceiver = (config) =>
  withFinalizedMod(config, [
    "android",
    (mod) => {
      const androidPackage = mod.android?.package;
      if (!androidPackage) throw new Error("home-widget: no android.package");
      const file = path.join(
        mod.modRequest.platformProjectRoot,
        "app/src/main/java",
        ...androidPackage.split("."),
        "widget",
        `${WIDGET_NAME}.java`,
      );
      if (!fs.existsSync(file))
        throw new Error(`home-widget: react-native-android-widget did not generate ${file}`);
      fs.writeFileSync(file, widgetReceiverJava(androidPackage));
      return mod;
    },
  ]);

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withHomeWidgetStrings = (config) =>
  withDangerousMod(config, [
    "android",
    (mod) => {
      const all = JSON.parse(fs.readFileSync(path.join(__dirname, "strings.json"), "utf8"));
      const res = path.join(mod.modRequest.platformProjectRoot, "app/src/main/res");
      for (const [locale, folder] of Object.entries(FOLDERS)) {
        const strings = all[locale];
        if (!strings) throw new Error(`home-widget: no ${locale} strings in strings.json`);
        fs.mkdirSync(path.join(res, folder), { recursive: true });
        fs.writeFileSync(path.join(res, folder, "home_widget_strings.xml"), stringsXml(strings));
      }
      return mod;
    },
  ]);

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withHomeWidget = (config) => withHomeWidgetTapReceiver(withHomeWidgetStrings(config));

module.exports = withHomeWidget;
module.exports.stringsXml = stringsXml;
module.exports.widgetReceiverJava = widgetReceiverJava;
