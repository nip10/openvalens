import { describe, expect, test } from "bun:test";

import {
  buildMarkerTrend,
  computeTrendDirection,
  createMarkerTrendTool,
  executeMarkerTrend,
  markerTrendInput,
  markerTrendOutput,
  resolveMarker,
} from "./marker-trend";
import {
  FIXED_NOW,
  ORG_A,
  ORG_B,
  createCapturingLogger,
  createFakeSources,
  marker,
  toolContext,
} from "./test-fixtures";

const FERRITIN = marker("blood_marker_ferritin", "Ferritin", "ng/mL", [40, 46, 52]);
const LDL = marker("blood_marker_ldl", "LDL Cholesterol", "mg/dL", [130, 112]);
const EMPTY = marker("blood_marker_hba1c", "HbA1c", "%", []);

describe("markerTrend input", () => {
  test("validates markerKey and rejects tenant overrides", () => {
    expect(markerTrendInput.safeParse({ markerKey: "ferritin" }).success).toBe(true);
    expect(markerTrendInput.safeParse({ markerKey: "" }).success).toBe(false);
    expect(markerTrendInput.safeParse({ markerKey: "   " }).success).toBe(false);
    expect(markerTrendInput.safeParse({ markerKey: "x".repeat(65) }).success).toBe(false);
    expect(markerTrendInput.safeParse({}).success).toBe(false);
    expect(
      markerTrendInput.safeParse({ markerKey: "ferritin", organizationId: ORG_B }).success,
    ).toBe(false);
  });
});

describe("computeTrendDirection", () => {
  test("needs at least two readings", () => {
    expect(computeTrendDirection([])).toBe("insufficient_data");
    expect(computeTrendDirection([5])).toBe("insufficient_data");
  });

  test("reports up, down and flat from first to latest", () => {
    expect(computeTrendDirection([40, 52])).toBe("up");
    expect(computeTrendDirection([130, 112])).toBe("down");
    expect(computeTrendDirection([100, 103])).toBe("flat");
    expect(computeTrendDirection([7, 7])).toBe("flat");
    expect(computeTrendDirection([0, 1])).toBe("up");
  });
});

describe("resolveMarker", () => {
  const markers = [FERRITIN, LDL];

  test("matches the short key, the full code and the display name", () => {
    expect(resolveMarker(markers, "ferritin")?.code).toBe("blood_marker_ferritin");
    expect(resolveMarker(markers, "BLOOD_MARKER_FERRITIN")?.code).toBe("blood_marker_ferritin");
    expect(resolveMarker(markers, "LDL Cholesterol")?.code).toBe("blood_marker_ldl");
  });

  test("returns null for unknown keys", () => {
    expect(resolveMarker(markers, "glucose")).toBeNull();
    expect(resolveMarker(markers, "%")).toBeNull();
  });
});

describe("buildMarkerTrend", () => {
  test("returns the real series and its direction", () => {
    const result = buildMarkerTrend([FERRITIN, LDL], { markerKey: "ferritin" }, FIXED_NOW);

    expect(() => markerTrendOutput.parse(result)).not.toThrow();
    expect(result).toEqual({
      status: "ok",
      markerKey: "ferritin",
      code: "blood_marker_ferritin",
      displayName: "Ferritin",
      unit: "ng/mL",
      trend: "up",
      sampleCount: 3,
      first: { sampledAt: "2026-01-01T00:00:00.000Z", value: 40 },
      latest: { sampledAt: "2026-01-15T00:00:00.000Z", value: 52 },
      changeAbsolute: 12,
      points: FERRITIN.recentValues,
      generatedAt: FIXED_NOW.toISOString(),
    });
  });

  test("reports insufficient_data for a single reading", () => {
    const single = marker("blood_marker_ferritin", "Ferritin", "ng/mL", [44]);
    const result = buildMarkerTrend([single], { markerKey: "ferritin" }, FIXED_NOW);
    expect(result).toMatchObject({ status: "ok", trend: "insufficient_data", sampleCount: 1 });
  });

  test("returns an honest no_data result for a defined marker without readings", () => {
    const result = buildMarkerTrend([EMPTY], { markerKey: "hba1c" }, FIXED_NOW);
    expect(result).toEqual({
      status: "no_data",
      markerKey: "hba1c",
      code: "blood_marker_hba1c",
      displayName: "HbA1c",
      unit: "%",
      trend: "insufficient_data",
      sampleCount: 0,
      points: [],
      generatedAt: FIXED_NOW.toISOString(),
    });
  });

  test("returns not_found with the org's own marker codes for an unknown key", () => {
    const result = buildMarkerTrend([FERRITIN, LDL], { markerKey: "glucose" }, FIXED_NOW);
    expect(result).toEqual({
      status: "not_found",
      markerKey: "glucose",
      availableMarkers: ["blood_marker_ferritin", "blood_marker_ldl"],
      generatedAt: FIXED_NOW.toISOString(),
    });
  });

  test("returns not_found with no markers when the org has none", () => {
    const result = buildMarkerTrend([], { markerKey: "ferritin" }, FIXED_NOW);
    expect(result).toMatchObject({ status: "not_found", availableMarkers: [] });
  });
});

describe("markerTrend tool execution", () => {
  test("reads only the bound organization's markers", async () => {
    const { sources, calls } = createFakeSources({
      [ORG_A]: { labs: [FERRITIN] },
      [ORG_B]: { labs: [marker("blood_marker_ferritin", "Ferritin", "ng/mL", [900, 999])] },
    });

    const result = await executeMarkerTrend(toolContext({ sources }), { markerKey: "ferritin" });

    expect(result).toMatchObject({ status: "ok", trend: "up", sampleCount: 3 });
    expect(calls).toEqual([{ port: "listLabMarkers", organizationId: ORG_A }]);
    expect(JSON.stringify(result)).not.toContain("999");
  });

  test("a marker only another org defines is not_found, not leaked", async () => {
    const { sources } = createFakeSources({
      [ORG_A]: { labs: [FERRITIN] },
      [ORG_B]: { labs: [marker("blood_marker_cortisol", "Cortisol", "ug/dL", [15, 18])] },
    });

    const result = await executeMarkerTrend(toolContext({ sources }), { markerKey: "cortisol" });

    expect(result).toMatchObject({
      status: "not_found",
      availableMarkers: ["blood_marker_ferritin"],
    });
  });

  test("returns unavailable without reading data when records:read is denied", async () => {
    const { sources, calls } = createFakeSources({ [ORG_A]: { labs: [FERRITIN] } });

    const result = await executeMarkerTrend(
      toolContext({ sources, canReadRecords: async () => false }),
      { markerKey: "ferritin" },
    );

    expect(result).toEqual({
      status: "unavailable",
      markerKey: "ferritin",
      reason: "permission_denied",
      generatedAt: FIXED_NOW.toISOString(),
    });
    expect(calls).toHaveLength(0);
  });

  test.each([
    ["user has no consent row", { orgMetadata: { aiConsent: true }, userGranted: null }],
    ["user revoked consent", { orgMetadata: { aiConsent: true }, userGranted: false }],
    ["org consent disabled", { orgMetadata: {}, userGranted: true }],
    ["org consent is chat-only", { orgMetadata: { aiConsent: "chat" }, userGranted: true }],
  ])("returns unavailable without reading data when %s", async (_label, consent) => {
    const { sources, calls } = createFakeSources({ [ORG_A]: { labs: [FERRITIN] } });

    const result = await executeMarkerTrend(toolContext({ sources, consent }), {
      markerKey: "ferritin",
    });

    expect(result).toMatchObject({ status: "unavailable", reason: "consent_required" });
    expect(calls).toHaveLength(0);
  });

  test("logs neither the marker key nor values", async () => {
    const { sources } = createFakeSources({ [ORG_A]: { labs: [FERRITIN] } });
    const { logger, records } = createCapturingLogger();

    await executeMarkerTrend(toolContext({ sources, logger }), { markerKey: "ferritin" });

    const serialized = JSON.stringify(records);
    expect(records.map((record) => record.event)).toEqual(["ai.tool.executed"]);
    expect(serialized).not.toContain("ferritin");
    expect(serialized).not.toContain("52");
  });

  test("the AI SDK tool runs the real execution", async () => {
    const { sources } = createFakeSources({ [ORG_A]: { labs: [LDL] } });
    const trendTool = createMarkerTrendTool(toolContext({ sources }));

    const output = await trendTool.execute?.({ markerKey: "ldl" }, {} as never);
    expect(output).toMatchObject({ status: "ok", code: "blood_marker_ldl", trend: "down" });
  });
});
