import { describe, expect, test } from "bun:test";

import { buildLabsResult, executeLabs, labsInput, labsOutput, selectLabPanel } from "./labs";
import { FIXED_NOW, ORG_A, bloodPanel, createFakeSources, toolContext } from "./test-fixtures";

const OLD = bloodPanel(1, "2026-01-05", [
  { testKey: "ferritin", testName: "Ferritin", value: 40, unit: "ng/mL", category: "Iron" },
]);
const NEW = bloodPanel(2, "2026-03-01T08:30:00.000Z", [
  {
    testKey: "hemoglobin",
    testName: "Hemoglobin",
    value: 14.1,
    unit: "g/dL",
    category: "Hematology",
    refRangeLow: 13,
    refRangeHigh: 17,
  },
  {
    testKey: "crp",
    testName: "CRP",
    value: null,
    valueText: "< 0.3",
    unit: "mg/L",
    category: "Inflammation",
    flag: "high",
  },
  { testKey: "ferritin", testName: "Ferritin", value: 52, unit: "ng/mL", category: "Iron" },
]);
const PANELS = [NEW.panel, OLD.panel];

describe("labs input", () => {
  test("accepts an optional real date and category only", () => {
    expect(labsInput.safeParse({}).success).toBe(true);
    expect(labsInput.safeParse({ date: "2026-03-01", category: "Iron" }).success).toBe(true);
    expect(labsInput.safeParse({ date: "2026-02-30" }).success).toBe(false);
    expect(labsInput.safeParse({ date: "March 1" }).success).toBe(false);
    expect(labsInput.safeParse({ date: "2026-13-45" }).success).toBe(false);
    expect(labsInput.safeParse({ category: "" }).success).toBe(false);
    expect(labsInput.safeParse({ panelId: 2 }).success).toBe(false);
  });
});

describe("selectLabPanel", () => {
  test("defaults to the newest panel and matches a date by its calendar day", () => {
    expect(selectLabPanel(PANELS, {})?.id).toBe(2);
    expect(selectLabPanel(PANELS, { date: "2026-03-01" })?.id).toBe(2);
    expect(selectLabPanel(PANELS, { date: "2026-01-05" })?.id).toBe(1);
    expect(selectLabPanel(PANELS, { date: "2025-12-31" })).toBeNull();
  });
});

describe("buildLabsResult", () => {
  test("projects the panel markers in a stable order with recorded flags", () => {
    const result = buildLabsResult(PANELS, NEW, {}, FIXED_NOW);

    expect(() => labsOutput.parse(result)).not.toThrow();
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result).toMatchObject({
      panelDate: "2026-03-01",
      panelCount: 2,
      availablePanelDates: ["2026-03-01", "2026-01-05"],
      availableCategories: ["Hematology", "Inflammation", "Iron"],
      markerCount: 3,
    });
    expect(result.markers.map((row) => row.testKey)).toEqual(["hemoglobin", "crp", "ferritin"]);
    expect(result.markers[0]).toEqual({
      testKey: "hemoglobin",
      testName: "Hemoglobin",
      category: "Hematology",
      value: 14.1,
      valueText: null,
      unit: "g/dL",
      refRangeLow: 13,
      refRangeHigh: 17,
      refRangeText: null,
      sourceFlag: null,
      optimalRangeFlag: null,
    });
    // Text results stay text; the lab's flag is normalised, never invented.
    expect(result.markers[1]).toMatchObject({
      value: null,
      valueText: "< 0.3",
      sourceFlag: "HIGH",
    });
  });

  test("narrows to a category case-insensitively", () => {
    const result = buildLabsResult(PANELS, NEW, { category: "iron" }, FIXED_NOW);
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.markers.map((row) => row.testKey)).toEqual(["ferritin"]);
    expect(result.category).toBe("iron");
  });

  test("reports unknown dates as not_found with the recorded dates", () => {
    expect(buildLabsResult(PANELS, null, { date: "2025-12-31" }, FIXED_NOW)).toEqual({
      status: "not_found",
      requestedDate: "2025-12-31",
      availablePanelDates: ["2026-03-01", "2026-01-05"],
      generatedAt: FIXED_NOW.toISOString(),
    });
  });

  test("an org without panels gets no_data", () => {
    expect(buildLabsResult([], null, {}, FIXED_NOW).status).toBe("no_data");
  });
});

describe("labs execution", () => {
  test("loads only the selected panel", async () => {
    const { sources, calls } = createFakeSources({ [ORG_A]: { bloodPanels: [OLD, NEW] } });

    const result = await executeLabs(toolContext({ sources }), { date: "2026-01-05" });

    expect(result).toMatchObject({ status: "ok", panelDate: "2026-01-05", markerCount: 1 });
    expect(calls.map((call) => call.port)).toEqual(["listBloodPanels", "getBloodPanel"]);
  });

  test("does not load a panel for an unknown date", async () => {
    const { sources, calls } = createFakeSources({ [ORG_A]: { bloodPanels: [OLD, NEW] } });

    const result = await executeLabs(toolContext({ sources }), { date: "2024-01-01" });

    expect(result.status).toBe("not_found");
    expect(calls.map((call) => call.port)).toEqual(["listBloodPanels"]);
  });
});
