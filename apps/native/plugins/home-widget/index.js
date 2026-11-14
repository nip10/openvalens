// @ts-check
const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("expo/config-plugins");

/**
 * The home-screen widget's Android picker name and description (#449), in
 * every shipped language. `react-native-android-widget` (its own entry in
 * app.json) points the receiver at `@string/home_widget_name` and
 * `@string/home_widget_description`; this writes those strings from
 * `strings.json`, which `bun run widget:strings` generates from the Lingui
 * catalogs. Any Portuguese goes to `values-pt`, as the app maps every
 * Portuguese to pt-PT.
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

module.exports = withHomeWidgetStrings;
module.exports.stringsXml = stringsXml;
