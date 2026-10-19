import { describe, expect, test } from "bun:test";

import {
  mayShowStoredMeasurementValue,
  makePrivateMeasurementPayload,
  nextKindDraft,
  nextUnitDraft,
  privateMeasurementAccessState,
  privateMeasurementHistoryState,
  privateMeasurementQueryKeys,
  shouldShowPrivateMeasurementDeleteError,
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

  test("scopes preference and history caches to both authenticated subject and workspace", () => {
    const a = privateMeasurementQueryKeys({ userId: "member-a", organizationId: "workspace-a" });
    const b = privateMeasurementQueryKeys({ userId: "member-b", organizationId: "workspace-a" });
    const c = privateMeasurementQueryKeys({ userId: "member-a", organizationId: "workspace-b" });
    expect(a.preference).not.toEqual(b.preference);
    expect(a.list).not.toEqual(b.list);
    expect(a.preference).not.toEqual(c.preference);
    expect(a.list).not.toEqual(c.list);
  });

  test("the access and history adapters fail closed and distinguish UI states", () => {
    expect(
      privateMeasurementAccessState({
        identityKnown: false,
        preferenceStatus: "success",
        enabled: true,
      }),
    ).toBe("identity-pending");
    expect(
      privateMeasurementAccessState({ identityKnown: true, preferenceStatus: "pending" }),
    ).toBe("identity-pending");
    expect(privateMeasurementAccessState({ identityKnown: true, preferenceStatus: "error" })).toBe(
      "preference-error",
    );
    expect(
      privateMeasurementAccessState({
        identityKnown: true,
        preferenceStatus: "success",
        enabled: false,
      }),
    ).toBe("disabled");
    expect(
      privateMeasurementAccessState({
        identityKnown: true,
        preferenceStatus: "success",
        enabled: true,
      }),
    ).toBe("enabled");
    expect(privateMeasurementHistoryState({ status: "pending" })).toBe("loading");
    expect(privateMeasurementHistoryState({ status: "error" })).toBe("error");
    expect(privateMeasurementHistoryState({ status: "success", count: 0 })).toBe("empty");
    expect(privateMeasurementHistoryState({ status: "success", count: 1 })).toBe("ready");
  });

  test("kind and unit changes produce blank drafts instead of reinterpreting entered values", () => {
    expect(nextKindDraft("waist")).toEqual({ kind: "waist", unit: "cm", value: "" });
    expect(nextKindDraft("weight")).toEqual({ kind: "weight", unit: "kg", value: "" });
    expect(nextUnitDraft("lb")).toEqual({ unit: "lb", value: "" });
  });

  test("payload validation rejects invalid timestamps and incompatible units", () => {
    const base = {
      kind: "weight" as const,
      unit: "kg",
      value: "62.5",
      measuredAtLocal: "2026-10-18T10:30",
    };
    expect(makePrivateMeasurementPayload(base)).toEqual({
      kind: "weight",
      unit: "kg",
      value: 62.5,
      measuredAt: new Date("2026-10-18T10:30").toISOString(),
    });
    expect(makePrivateMeasurementPayload({ ...base, measuredAtLocal: "not-a-time" })).toBeNull();
    expect(
      makePrivateMeasurementPayload({ ...base, measuredAtLocal: "2026-02-31T10:30" }),
    ).toBeNull();
    expect(makePrivateMeasurementPayload({ ...base, unit: "cm" })).toBeNull();
    expect(makePrivateMeasurementPayload({ ...base, value: "" })).toBeNull();
  });

  test("delete failure remains attached to its row for visible recovery", () => {
    expect(
      shouldShowPrivateMeasurementDeleteError({
        rowId: "entry-a",
        failedRowId: "entry-a",
        isError: true,
      }),
    ).toBe(true);
    expect(
      shouldShowPrivateMeasurementDeleteError({
        rowId: "entry-b",
        failedRowId: "entry-a",
        isError: true,
      }),
    ).toBe(false);
    expect(
      shouldShowPrivateMeasurementDeleteError({
        rowId: "entry-a",
        failedRowId: "entry-a",
        isError: false,
      }),
    ).toBe(false);
  });
});
