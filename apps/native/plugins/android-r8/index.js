// @ts-check
const fs = require("node:fs");
const path = require("node:path");
const { withAppBuildGradle, withDangerousMod } = require("expo/config-plugins");

/**
 * R8 for Android release builds (#522). `expo-build-properties` turns on
 * minification and resource shrinking; this plugin finishes the job:
 *
 * - The prebuild template hands R8 `proguard-android.txt`, which carries
 *   `-dontoptimize`, so R8 only shrinks and renames. Play Console flags that as
 *   low DEX optimisation; `proguard-android-optimize.txt` is the same rules
 *   without that line.
 * - Appends our keep rules (`proguard-rules.pro` next to this file) to
 *   `android/app/proguard-rules.pro`.
 */

const DEFAULT_RULES = 'getDefaultProguardFile("proguard-android.txt")';
const OPTIMIZE_RULES = 'getDefaultProguardFile("proguard-android-optimize.txt")';
const BEGIN = "# @generated begin openvalens-android-r8";
const END = "# @generated end openvalens-android-r8";

/** @param {string} gradle the app's `build.gradle` */
function useOptimizeRules(gradle) {
  if (gradle.includes(OPTIMIZE_RULES)) return gradle;
  if (!gradle.includes(DEFAULT_RULES)) {
    throw new Error(
      `android-r8: ${DEFAULT_RULES} is not in android/app/build.gradle; check the release proguardFiles by hand.`,
    );
  }
  return gradle.replace(DEFAULT_RULES, OPTIMIZE_RULES);
}

/**
 * @param {string} contents the app's `proguard-rules.pro`
 * @param {string} rules the rules to put in the generated block
 */
function withRulesBlock(contents, rules) {
  const start = contents.indexOf(BEGIN);
  const end = contents.indexOf(END);
  const kept =
    start === -1 || end === -1
      ? contents
      : contents.slice(0, start) + contents.slice(end + END.length).replace(/^\n/, "");
  return `${kept.trimEnd()}\n\n${BEGIN}\n${rules.trim()}\n${END}\n`;
}

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withAndroidR8 = (config) => {
  config = withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== "groovy") {
      throw new Error("android-r8: expected a Groovy android/app/build.gradle");
    }
    mod.modResults.contents = useOptimizeRules(mod.modResults.contents);
    return mod;
  });
  return withDangerousMod(config, [
    "android",
    (mod) => {
      const rules = fs.readFileSync(path.join(__dirname, "proguard-rules.pro"), "utf8");
      const file = path.join(mod.modRequest.platformProjectRoot, "app", "proguard-rules.pro");
      fs.writeFileSync(file, withRulesBlock(fs.readFileSync(file, "utf8"), rules));
      return mod;
    },
  ]);
};

module.exports = withAndroidR8;
module.exports.useOptimizeRules = useOptimizeRules;
module.exports.withRulesBlock = withRulesBlock;
