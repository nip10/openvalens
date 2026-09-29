import assert from "node:assert/strict";
import test from "node:test";

import {
  coerceKnownChangeTypes,
  isAllowedMedicationStatus,
  isAllowedSupplementChangeType,
  isAllowedSupplementScheduleStatus,
  isAllowedTimeOfDay,
  parseTrimmedOptionalString,
  parseTrimmedRequiredString,
  todayIsoDate,
} from "./validation";

test("parseTrimmedRequiredString returns trimmed value for non-empty strings", () => {
  assert.equal(parseTrimmedRequiredString({ name: "  Magnesium  " }, "name"), "Magnesium");
});

test("parseTrimmedRequiredString returns null for empty/whitespace/non-string inputs", () => {
  assert.equal(parseTrimmedRequiredString({ name: "" }, "name"), null);
  assert.equal(parseTrimmedRequiredString({ name: "   " }, "name"), null);
  assert.equal(parseTrimmedRequiredString({}, "name"), null);
  assert.equal(parseTrimmedRequiredString({ name: 42 }, "name"), null);
});

test("parseTrimmedOptionalString returns undefined for empty / missing / non-string", () => {
  assert.equal(parseTrimmedOptionalString({ name: "  ok  " }, "name"), "ok");
  assert.equal(parseTrimmedOptionalString({ name: "" }, "name"), undefined);
  assert.equal(parseTrimmedOptionalString({ name: "   " }, "name"), undefined);
  assert.equal(parseTrimmedOptionalString({}, "name"), undefined);
  assert.equal(parseTrimmedOptionalString({ name: null }, "name"), undefined);
});

test("isAllowedMedicationStatus narrows to the closed union", () => {
  assert.equal(isAllowedMedicationStatus("active"), true);
  assert.equal(isAllowedMedicationStatus("paused"), true);
  assert.equal(isAllowedMedicationStatus("completed"), true);
  assert.equal(isAllowedMedicationStatus("unknown"), false);
  assert.equal(isAllowedMedicationStatus(""), false);
});

test("isAllowedSupplementScheduleStatus narrows to the closed union", () => {
  assert.equal(isAllowedSupplementScheduleStatus("active"), true);
  assert.equal(isAllowedSupplementScheduleStatus("paused"), true);
  assert.equal(isAllowedSupplementScheduleStatus("stopped"), true);
  assert.equal(isAllowedSupplementScheduleStatus("removed"), false);
});

test("isAllowedSupplementChangeType narrows to the closed union", () => {
  assert.equal(isAllowedSupplementChangeType("added"), true);
  assert.equal(isAllowedSupplementChangeType("dose_changed"), true);
  assert.equal(isAllowedSupplementChangeType("garbage"), false);
});

test("isAllowedTimeOfDay narrows to the canonical list", () => {
  assert.equal(isAllowedTimeOfDay("morning"), true);
  assert.equal(isAllowedTimeOfDay("training"), true);
  assert.equal(isAllowedTimeOfDay("evening"), false);
});

test("todayIsoDate returns a YYYY-MM-DD string", () => {
  const value = todayIsoDate(new Date("2026-03-07T10:00:00.000Z"));
  assert.equal(value, "2026-03-07");
});

test("coerceKnownChangeTypes filters out unsupported values", () => {
  assert.deepEqual(coerceKnownChangeTypes(["added", "garbage", "dose_changed", ""]), [
    "added",
    "dose_changed",
  ]);
});
