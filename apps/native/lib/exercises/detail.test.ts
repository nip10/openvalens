import { describe, expect, mock, test } from "bun:test";

mock.module("react-native", () => ({ Platform: { OS: "ios" } }));
const { displayAssets, exercisePickTestId, imageCredit, mediaSource, rowChips } =
  await import("./detail");

const asset = (source: "wger" | "workout-guide", n: number) => ({
  source,
  assetId: `00000000-0000-4000-8000-00000000000${n}`,
  path: `/api/exercise-assets/00000000-0000-4000-8000-00000000000${n}`,
  contentType: "image/png" as const,
  width: 512,
  height: 512,
  license: "CC-BY-SA-4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  author: source === "wger" ? "photographer" : "Bryl Lim, after Everkinetic",
  attribution: source === "wger" ? null : "Workout Guide by Bryl Lim …",
  sourceUrl: "https://example.test/x.png",
  transformationNotice: "Re-encoded",
});

describe("exercise detail helpers (#404)", () => {
  test("one source per exercise, Workout Guide first", () => {
    const mixed = [asset("wger", 1), asset("workout-guide", 2), asset("workout-guide", 3)];
    expect(mediaSource(mixed)).toBe("workout-guide");
    expect(displayAssets(mixed).map((a) => a.source)).toEqual(["workout-guide", "workout-guide"]);
    expect(displayAssets([asset("wger", 1), asset("wger", 2)])).toHaveLength(1);
    expect(mediaSource([])).toBeNull();
  });

  test("credit names the licence and author of the shown source", () => {
    expect(imageCredit([asset("workout-guide", 1)])).toMatchObject({
      kind: "workout-guide",
      license: "CC BY-SA 4.0",
      attribution: "Workout Guide by Bryl Lim …",
    });
    expect(imageCredit([asset("wger", 1)])).toMatchObject({ kind: "wger", author: "photographer" });
    expect(imageCredit([])).toBeNull();
  });

  test("row chips: primary muscles, then real equipment", () => {
    expect(
      rowChips({
        muscles: [
          { name: "Quads", role: "primary" },
          { name: "Glutes", role: "primary" },
          { name: "Core", role: "secondary" },
        ],
        equipment: [{ name: "Barbell" }, { name: "Rack" }],
      }),
    ).toEqual(["Quads", "Glutes", "Barbell"]);
    expect(rowChips({ muscles: [], equipment: [{ name: "none (bodyweight exercise)" }] })).toEqual(
      [],
    );
  });
  test("picker test ids are language independent", () => {
    expect(
      exercisePickTestId({
        id: 2,
        source: "wger",
        sourceRecordUrl: "https://wger.de/api/v2/exerciseinfo/73/",
      }),
    ).toBe("exercise-pick-wger-73");
    expect(exercisePickTestId({ id: 9, source: "user", sourceRecordUrl: null })).toBe(
      "exercise-pick-9",
    );
  });
});
