import { describe, expect, test } from "bun:test";

import {
  buildMarkerTrend,
  markerTrendInput,
  markerTrendOutput,
  markerTrendTool,
} from "./marker-trend";

describe("markerTrend tool", () => {
  test("validates the markerKey input", () => {
    expect(markerTrendInput.safeParse({ markerKey: "ferritin" }).success).toBe(true);
    expect(markerTrendInput.safeParse({ markerKey: "" }).success).toBe(false);
    expect(markerTrendInput.safeParse({ markerKey: "x".repeat(65) }).success).toBe(false);
    expect(markerTrendInput.safeParse({}).success).toBe(false);
  });

  test("returns the markerKey and a placeholder trend", () => {
    const result = buildMarkerTrend({ markerKey: "ferritin" });
    expect(result).toEqual({ markerKey: "ferritin", trend: "flat" });
    expect(() => markerTrendOutput.parse(result)).not.toThrow();
  });

  test("execute echoes the input markerKey", async () => {
    const execute = markerTrendTool.execute;
    expect(typeof execute).toBe("function");
    const output = await execute?.({ markerKey: "ldl" }, {} as never);
    expect(output).toEqual({ markerKey: "ldl", trend: "flat" });
  });
});
