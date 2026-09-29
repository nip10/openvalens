import { describe, expect, test } from "bun:test";

import { buildHealthSnapshot, healthSnapshotOutput, healthSnapshotTool } from "./health-snapshot";

describe("healthSnapshot tool", () => {
  test("returns a stable placeholder shape", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const snapshot = buildHealthSnapshot(now);

    expect(snapshot.status).toBe("placeholder");
    expect(snapshot.generatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(snapshot.counts).toEqual({
      outOfRangeMarkers: 0,
      activeSupplements: 0,
      activeGoals: 0,
    });
    expect(() => healthSnapshotOutput.parse(snapshot)).not.toThrow();
  });

  test("accepts an empty input object", async () => {
    const execute = healthSnapshotTool.execute;
    expect(typeof execute).toBe("function");
    const output = await execute?.({}, {} as never);
    expect(() => healthSnapshotOutput.parse(output)).not.toThrow();
  });
});
