import { describe, expect, test } from "bun:test";

import {
  buildPanelCompareResult,
  compareBloodPanels,
  executePanelCompare,
  panelCompareInput,
  panelCompareOutput,
  selectPanelPair,
} from "./panel-compare";
import { FIXED_NOW, ORG_A, bloodPanel, createFakeSources, toolContext } from "./test-fixtures";

const JAN = bloodPanel(1, "2026-01-05", [
  { testKey: "ferritin", testName: "Ferritin", value: 40, unit: "ng/mL" },
  { testKey: "glucose", testName: "Glucose", value: 92 },
  { testKey: "vitd", testName: "Vitamin D", value: 30 },
  { testKey: "crp", testName: "CRP", value: null, valueText: "< 0.3" },
]);
const FEB = bloodPanel(2, "2026-02-05", [{ testKey: "ferritin", testName: "Ferritin", value: 45 }]);
const MAR = bloodPanel(3, "2026-03-01", [
  { testKey: "ferritin", testName: "Ferritin", value: 52, unit: "ng/mL" },
  { testKey: "glucose", testName: "Glucose", value: 92 },
  { testKey: "ldl", testName: "LDL", value: 120 },
  { testKey: "crp", testName: "CRP", value: 1.2 },
]);
const PANELS = [MAR.panel, FEB.panel, JAN.panel];

describe("panelCompare input", () => {
  test("takes both dates or neither, and they must differ", () => {
    expect(panelCompareInput.safeParse({}).success).toBe(true);
    expect(
      panelCompareInput.safeParse({ fromDate: "2026-01-05", toDate: "2026-03-01" }).success,
    ).toBe(true);
    expect(panelCompareInput.safeParse({ fromDate: "2026-01-05" }).success).toBe(false);
    expect(
      panelCompareInput.safeParse({ fromDate: "2026-01-05", toDate: "2026-01-05" }).success,
    ).toBe(false);
    expect(panelCompareInput.safeParse({ panelIds: [1, 2] }).success).toBe(false);
  });
});

describe("selectPanelPair", () => {
  test("defaults to the two newest panels, older one first", () => {
    expect(selectPanelPair(PANELS, {})).toMatchObject({
      kind: "pair",
      from: { id: 2 },
      to: { id: 3 },
    });
  });

  test("orders requested dates chronologically", () => {
    expect(selectPanelPair(PANELS, { fromDate: "2026-03-01", toDate: "2026-01-05" })).toMatchObject(
      { kind: "pair", from: { id: 1 }, to: { id: 3 } },
    );
  });

  test("reports missing dates and too few panels", () => {
    expect(selectPanelPair(PANELS, { fromDate: "2025-01-01", toDate: "2026-03-01" })).toEqual({
      kind: "missing",
      dates: ["2025-01-01"],
    });
    expect(selectPanelPair([JAN.panel], {})).toEqual({ kind: "insufficient" });
  });
});

describe("compareBloodPanels", () => {
  test("reports recorded differences and never invents a change", () => {
    const rows = compareBloodPanels(JAN.markers, MAR.markers);

    expect(rows).toEqual([
      {
        testKey: "crp",
        testName: "CRP",
        unit: "mg/dL",
        fromValue: null,
        toValue: 1.2,
        change: null,
        changePct: null,
        direction: "not_numeric",
      },
      {
        testKey: "ferritin",
        testName: "Ferritin",
        unit: "ng/mL",
        fromValue: 40,
        toValue: 52,
        change: 12,
        changePct: 30,
        direction: "up",
      },
      expect.objectContaining({ testKey: "glucose", change: 0, direction: "same" }),
      expect.objectContaining({ testKey: "ldl", fromValue: null, direction: "only_in_to" }),
      expect.objectContaining({ testKey: "vitd", toValue: null, direction: "only_in_from" }),
    ]);
  });
});

describe("buildPanelCompareResult", () => {
  test("summarises the comparison", () => {
    const selection = selectPanelPair(PANELS, { fromDate: "2026-01-05", toDate: "2026-03-01" });
    const result = buildPanelCompareResult(
      PANELS,
      selection,
      { from: JAN.markers, to: MAR.markers },
      FIXED_NOW,
    );

    expect(() => panelCompareOutput.parse(result)).not.toThrow();
    expect(result).toMatchObject({
      status: "ok",
      fromDate: "2026-01-05",
      toDate: "2026-03-01",
      comparedCount: 2,
      changedCount: 1,
      onlyInFromCount: 1,
      onlyInToCount: 1,
    });
  });

  test("returns not_found with the recorded dates for unknown dates", () => {
    const result = buildPanelCompareResult(
      PANELS,
      { kind: "missing", dates: ["2025-01-01"] },
      null,
      FIXED_NOW,
    );
    expect(result).toEqual({
      status: "not_found",
      missingDates: ["2025-01-01"],
      availablePanelDates: ["2026-03-01", "2026-02-05", "2026-01-05"],
      generatedAt: FIXED_NOW.toISOString(),
    });
  });
});

describe("panelCompare execution", () => {
  test("loads exactly the two selected panels", async () => {
    const { sources, calls } = createFakeSources({ [ORG_A]: { bloodPanels: [JAN, FEB, MAR] } });

    const result = await executePanelCompare(toolContext({ sources }), {});

    expect(result).toMatchObject({ status: "ok", fromDate: "2026-02-05", toDate: "2026-03-01" });
    expect(calls.filter((call) => call.port === "getBloodPanel")).toHaveLength(2);
  });

  test("a single panel is insufficient_data, not a fake comparison", async () => {
    const { sources } = createFakeSources({ [ORG_A]: { bloodPanels: [JAN] } });

    await expect(executePanelCompare(toolContext({ sources }), {})).resolves.toMatchObject({
      status: "insufficient_data",
      panelCount: 1,
      availablePanelDates: ["2026-01-05"],
    });
  });
});
