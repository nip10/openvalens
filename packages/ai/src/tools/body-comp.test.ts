import { describe, expect, test } from "bun:test";

import { BODY_COMP_MAX_MEASUREMENTS, bodyCompOutput, buildBodyComp } from "./body-comp";
import { FIXED_NOW, dexaScanRow } from "./test-fixtures";

function compositionMarker(date: string, bodyFatPct: number | null) {
  return {
    date,
    measuredAt: `${date}T07:00:00.000Z`,
    source: "SYNTHETIC_SCALE_NAME",
    confidence: 0.8,
    weightKg: 72.456,
    bodyFatPct,
    fatMassKg: 14.1,
    leanMassKg: null,
    boneMassKg: null,
  };
}

describe("buildBodyComp", () => {
  test("projects the two newest DEXA scans with masses in kg", () => {
    const result = buildBodyComp(
      [
        dexaScanRow(3, "2026-02-15"),
        dexaScanRow(2, "2025-08-15", { bodyFatPct: 22 }),
        dexaScanRow(1, "2025-01-01"),
      ],
      { compositionMarkers: [] },
      FIXED_NOW,
    );

    expect(() => bodyCompOutput.parse(result)).not.toThrow();
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.dexa.scanCount).toBe(3);
    expect(result.dexa.latest).toMatchObject({
      date: "2026-02-15",
      bodyFatPct: 20,
      fatMassKg: 15,
      leanMassKg: 57,
      boneMineralContentKg: 3,
      boneMineralDensityGPerCm2: 1.234,
    });
    expect(result.dexa.previous).toMatchObject({ date: "2025-08-15", bodyFatPct: 22 });
    expect(result.measurements).toEqual({ status: "no_data", count: 0, items: [] });
    // Height and age are not part of the projection.
    expect(JSON.stringify(result)).not.toMatch(/height|"age"/);
  });

  test("keeps missing values null and caps measurements", () => {
    const markers = Array.from({ length: BODY_COMP_MAX_MEASUREMENTS + 4 }, (_unused, index) =>
      compositionMarker(`2026-02-${String(index + 1).padStart(2, "0")}`, index === 0 ? null : 19),
    );
    const result = buildBodyComp([], { compositionMarkers: markers }, FIXED_NOW);

    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.dexa).toEqual({ status: "no_data", scanCount: 0, latest: null, previous: null });
    expect(result.measurements.count).toBe(BODY_COMP_MAX_MEASUREMENTS);
    expect(result.measurements.items[0]).toEqual({
      date: "2026-02-01",
      weightKg: 72.46,
      bodyFatPct: null,
      fatMassKg: 14.1,
      leanMassKg: null,
      boneMassKg: null,
    });
  });

  test("an org with neither scans nor measurements gets no_data", () => {
    expect(buildBodyComp([], { compositionMarkers: [] }, FIXED_NOW).status).toBe("no_data");
  });
});
