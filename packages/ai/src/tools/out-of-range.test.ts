import { describe, expect, test } from "bun:test";

import {
  OUT_OF_RANGE_MAX_PANELS,
  buildOutOfRange,
  executeOutOfRange,
  outOfRangeOutput,
} from "./out-of-range";
import { FIXED_NOW, ORG_A, bloodPanel, createFakeSources, toolContext } from "./test-fixtures";

const OLD = bloodPanel(1, "2026-01-05", [
  { testKey: "ferritin", testName: "Ferritin", value: 12, flag: "LOW", category: "Iron" },
  { testKey: "tsh", testName: "TSH", value: 6.1, flag: "HIGH", category: "Thyroid" },
]);
const NEW = bloodPanel(2, "2026-03-01", [
  { testKey: "ferritin", testName: "Ferritin", value: 52, category: "Iron" },
  { testKey: "ldl", testName: "LDL", value: 141, outOfRangeFlag: "HIGH", category: "Lipids" },
  { testKey: "potassium", testName: "Potassium", value: 6.8, flag: "CRITICAL", category: "Lytes" },
]);

describe("buildOutOfRange", () => {
  test("lists flagged latest readings only", () => {
    const result = buildOutOfRange([NEW, OLD], {}, FIXED_NOW);

    expect(() => outOfRangeOutput.parse(result)).not.toThrow();
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result).toMatchObject({
      panelsChecked: 2,
      newestPanelDate: "2026-03-01",
      oldestPanelDate: "2026-01-05",
      markersChecked: 4,
      flaggedCount: 3,
    });
    // Ferritin was LOW in January but the newer March reading is unflagged.
    expect(result.markers.map((row) => [row.testKey, row.panelDate])).toEqual([
      ["ldl", "2026-03-01"],
      ["potassium", "2026-03-01"],
      ["tsh", "2026-01-05"],
    ]);
    expect(result.markers[0]).toMatchObject({ sourceFlag: null, optimalRangeFlag: "HIGH" });
    expect(result.markers[1]).toMatchObject({ sourceFlag: "CRITICAL" });
    expect(result.basis).toContain("not a diagnosis");
  });

  test("an empty flag list is ok with zero flagged, not no_data", () => {
    const clean = bloodPanel(3, "2026-03-05", [{ testKey: "glucose", value: 90 }]);
    expect(buildOutOfRange([clean], {}, FIXED_NOW)).toMatchObject({
      status: "ok",
      markersChecked: 1,
      flaggedCount: 0,
      markers: [],
    });
  });

  test("filters by category and reports no_data when nothing matches", () => {
    const result = buildOutOfRange([NEW, OLD], { category: "thyroid" }, FIXED_NOW);
    expect(result).toMatchObject({ status: "ok", flaggedCount: 1 });
    expect(buildOutOfRange([NEW, OLD], { category: "Vitamins" }, FIXED_NOW)).toMatchObject({
      status: "no_data",
      panelsChecked: 2,
    });
    expect(buildOutOfRange([], {}, FIXED_NOW)).toMatchObject({
      status: "no_data",
      panelsChecked: 0,
    });
  });
});

describe("outOfRange execution", () => {
  test("scans at most the newest OUT_OF_RANGE_MAX_PANELS panels", async () => {
    const panels = Array.from({ length: OUT_OF_RANGE_MAX_PANELS + 3 }, (_unused, index) =>
      bloodPanel(index + 1, `2025-0${(index % 9) + 1}-01`, [{ testKey: "glucose", value: 90 }]),
    );
    const { sources, calls } = createFakeSources({ [ORG_A]: { bloodPanels: panels } });

    const result = await executeOutOfRange(toolContext({ sources }), {});

    expect(result).toMatchObject({ status: "ok", panelsChecked: OUT_OF_RANGE_MAX_PANELS });
    expect(calls.filter((call) => call.port === "getBloodPanel")).toHaveLength(
      OUT_OF_RANGE_MAX_PANELS,
    );
  });
});
