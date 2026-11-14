import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { generatedWidgetFiles, iosStringsFile, nativeWidgetStrings } from "./native-strings";

const NATIVE = join(import.meta.dir, "..", "..");

describe("the widget's native string files", () => {
  test("are up to date with the Lingui catalogs (run `bun run widget:strings`)", () => {
    for (const [path, contents] of Object.entries(generatedWidgetFiles()))
      expect({ path, contents: readFileSync(join(NATIVE, path), "utf8") }).toEqual({
        path,
        contents,
      });
  });

  test("carry every label in English and European Portuguese", () => {
    expect(nativeWidgetStrings("en")).toMatchObject({
      widget_name: "Quick log",
      water: "Water",
      water_action: "+1 glass",
      supplement_action: "Taken",
      log: "Log…",
    });
    const pt = nativeWidgetStrings("pt-PT");
    for (const [key, value] of Object.entries(nativeWidgetStrings("en")))
      expect({ key, translated: pt[key as keyof typeof pt] !== value }).toEqual({
        key,
        translated: true,
      });
  });

  test("escape quotes for the iOS strings format", () => {
    expect(iosStringsFile("en")).toContain('"log" = "Log…";');
    expect(
      iosStringsFile("en")
        .split("\n")
        .slice(1, -1)
        .every((line) => /^"\w+" = ".*";$/.test(line)),
    ).toBe(true);
  });
});
