import { describe, expect, test } from "bun:test";

import {
  mayShowStoredMeasurementValue,
  PRIVATE_MEASUREMENT_KINDS,
  unitsForMeasurement,
} from "./private-measurements";

describe("private measurement presenters", () => {
  test("keeps kind units compatible", () => {
    expect(PRIVATE_MEASUREMENT_KINDS).toEqual([
      "weight",
      "waist",
      "hip",
      "neck",
      "chest",
      "upper_arm",
      "thigh",
    ]);
    expect(unitsForMeasurement("weight")).toEqual(["kg", "lb"]);
    for (const kind of PRIVATE_MEASUREMENT_KINDS.filter((kind) => kind !== "weight")) {
      expect(unitsForMeasurement(kind)).toEqual(["cm", "in"]);
    }
  });

  test("never exposes stored numbers without a confirmed hide-numbers preference", () => {
    expect(mayShowStoredMeasurementValue(undefined)).toBe(false);
    expect(mayShowStoredMeasurementValue(true)).toBe(false);
    expect(mayShowStoredMeasurementValue(false)).toBe(true);
  });
});
