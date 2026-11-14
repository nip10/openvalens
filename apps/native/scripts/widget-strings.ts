/**
 * Writes the home-screen widget's native string files (#449) from the Lingui
 * catalogs: the iOS widget's `Localizable.strings` and the JSON the Android
 * config plugin reads. Run after `lingui compile` (`bun run i18n:compile`
 * does it).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { generatedWidgetFiles } from "../lib/home-widget/native-strings";

const NATIVE = join(import.meta.dir, "..");

for (const [path, contents] of Object.entries(generatedWidgetFiles())) {
  const target = join(NATIVE, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}
