import assert from "node:assert/strict";
import test from "node:test";

import {
  compareMarkers,
  computeMarkerChange,
  decorateMarkersWithContext,
  deriveOutOfRangeFlag,
  groupFamilyHistoryByRelation,
  groupMarkersByCategory,
  isFlaggedBySource,
  isRelatedMarker,
  isValidAgeOfOnset,
  pickOptimalRange,
  trimOrNull,
} from "./derived";
import type { BloodMarker, BloodMarkerInfo, FamilyHistoryEntry, OptimalRange } from "./types";

test("deriveOutOfRangeFlag returns null when value is missing", () => {
  assert.equal(deriveOutOfRangeFlag(null, { rangeLow: 1, rangeHigh: 5 }), null);
});

test("deriveOutOfRangeFlag returns null when value is inside the range", () => {
  assert.equal(deriveOutOfRangeFlag(3, { rangeLow: 1, rangeHigh: 5 }), null);
});

test("deriveOutOfRangeFlag returns LOW when value is below the range", () => {
  assert.equal(deriveOutOfRangeFlag(0.5, { rangeLow: 1, rangeHigh: 5 }), "LOW");
});

test("deriveOutOfRangeFlag returns HIGH when value is above the range", () => {
  assert.equal(deriveOutOfRangeFlag(6, { rangeLow: 1, rangeHigh: 5 }), "HIGH");
});

test("deriveOutOfRangeFlag handles one-sided ranges", () => {
  assert.equal(deriveOutOfRangeFlag(100, { rangeLow: null, rangeHigh: 80 }), "HIGH");
  assert.equal(deriveOutOfRangeFlag(40, { rangeLow: 50, rangeHigh: null }), "LOW");
  assert.equal(deriveOutOfRangeFlag(50, { rangeLow: 50, rangeHigh: null }), null);
});

test("deriveOutOfRangeFlag returns null when no optimal range exists", () => {
  assert.equal(deriveOutOfRangeFlag(3, null), null);
});

test("isFlaggedBySource recognises HIGH / LOW / CRITICAL only", () => {
  assert.equal(isFlaggedBySource("HIGH"), true);
  assert.equal(isFlaggedBySource("LOW"), true);
  assert.equal(isFlaggedBySource("CRITICAL"), true);
  assert.equal(isFlaggedBySource(null), false);
  assert.equal(isFlaggedBySource("normal"), false);
  assert.equal(isFlaggedBySource(""), false);
});

test("groupMarkersByCategory buckets markers and preserves order", () => {
  const markers: BloodMarker[] = [
    markerWith("Hematology", "hemoglobin"),
    markerWith("Lipids", "ldl"),
    markerWith("Hematology", "hematocrit"),
    markerWith("Liver", "alt"),
  ];
  const grouped = groupMarkersByCategory(markers);
  assert.deepEqual(Object.keys(grouped), ["Hematology", "Lipids", "Liver"]);
  assert.equal(grouped.Hematology!.length, 2);
  assert.equal(grouped.Lipids!.length, 1);
});

function markerWith(category: string, testKey: string): BloodMarker {
  return {
    id: 1,
    organizationId: "org-1",
    panelId: 1,
    category,
    subcategory: null,
    testName: testKey,
    testKey,
    valueNumeric: null,
    valueText: null,
    unit: null,
    refRangeLow: null,
    refRangeHigh: null,
    refRangeText: null,
    flag: null,
  };
}

test("computeMarkerChange returns null when either value is missing", () => {
  assert.equal(computeMarkerChange(null, 1, "2026-03-01"), null);
  assert.equal(computeMarkerChange(2, null, "2026-03-01"), null);
});

test("computeMarkerChange returns null pct when previous is zero", () => {
  const result = computeMarkerChange(5, 0, "2026-03-01");
  assert.equal(result?.pct, null);
  assert.equal(result?.diff, 5);
});

test("computeMarkerChange computes diff + pct", () => {
  const result = computeMarkerChange(110, 100, "2026-03-01");
  assert.equal(result?.diff, 10);
  assert.equal(result?.pct, 10);
});

test("compareMarkers returns one row per shared testKey with diff + pct", () => {
  const left = [markerWith("Lipids", "ldl"), markerWith("Lipids", "hdl")];
  left[0]!.valueNumeric = 100;
  left[1]!.valueNumeric = 50;
  const right = [markerWith("Lipids", "ldl"), markerWith("Lipids", "triglycerides")];
  right[0]!.valueNumeric = 110;
  right[1]!.valueNumeric = 80;

  const result = compareMarkers(left, right);

  assert.equal(result.length, 3);
  const ldl = result.find((r) => r.testKey === "ldl");
  assert.equal(ldl?.value1, 100);
  assert.equal(ldl?.value2, 110);
  assert.equal(ldl?.change, 10);
  assert.equal(ldl?.changePct, 10);
  const hdl = result.find((r) => r.testKey === "hdl");
  assert.equal(hdl?.value1, 50);
  assert.equal(hdl?.value2, null);
});

test("compareMarkers is deterministic — same input → same output", () => {
  const left = [markerWith("Lipids", "ldl")];
  left[0]!.valueNumeric = 100;
  const right = [markerWith("Lipids", "ldl")];
  right[0]!.valueNumeric = 110;
  const first = compareMarkers(left, right);
  const second = compareMarkers(left, right);
  assert.deepEqual(first, second);
});

function familyEntry(overrides: Partial<FamilyHistoryEntry> = {}): FamilyHistoryEntry {
  return {
    id: 1,
    organizationId: "org-1",
    relation: "father",
    condition: "Type 2 diabetes",
    ageOfOnset: null,
    notes: null,
    createdAt: "2026-03-07T10:00:00.000Z",
    ...overrides,
  };
}

test("groupFamilyHistoryByRelation buckets by relation with newest first", () => {
  const entries = [
    familyEntry({ id: 1, relation: "father", condition: "Diabetes" }),
    familyEntry({ id: 2, relation: "mother", condition: "Hypertension" }),
    familyEntry({ id: 3, relation: "father", condition: "Cardiac disease" }),
    familyEntry({ id: 4, relation: "father", condition: "Stroke" }),
  ];
  const grouped = groupFamilyHistoryByRelation(entries);
  assert.equal(grouped.length, 2);
  // father sorts before mother alphabetically.
  assert.equal(grouped[0]!.relation, "father");
  assert.deepEqual(
    grouped[0]!.entries.map((e) => e.condition),
    ["Stroke", "Cardiac disease", "Diabetes"],
  );
  assert.equal(grouped[1]!.relation, "mother");
  assert.equal(grouped[1]!.entries.length, 1);
});

test("pickOptimalRange prefers 'optimal' classification over 'standard'", () => {
  const ranges: OptimalRange[] = [
    {
      id: 1,
      testKey: "ldl",
      source: "Lab",
      rangeLow: 0,
      rangeHigh: 100,
      classification: "standard",
      explanation: null,
    },
    {
      id: 2,
      testKey: "ldl",
      source: "Optimal Lab",
      rangeLow: 0,
      rangeHigh: 70,
      classification: "optimal",
      explanation: null,
    },
  ];
  const picked = pickOptimalRange(ranges, "ldl");
  assert.equal(picked?.classification, "optimal");
});

test("pickOptimalRange returns null when no range exists for the testKey", () => {
  assert.equal(pickOptimalRange([], "ldl"), null);
});

test("decorateMarkersWithContext folds optimal range into each marker", () => {
  const markers: BloodMarker[] = [
    { ...markerWith("Lipids", "ldl"), valueNumeric: 120, flag: "HIGH" },
    { ...markerWith("Lipids", "hdl"), valueNumeric: 55, flag: null },
  ];
  const ranges: OptimalRange[] = [
    {
      id: 1,
      testKey: "ldl",
      source: "Optimal",
      rangeLow: 0,
      rangeHigh: 70,
      classification: "optimal",
      explanation: null,
    },
    {
      id: 2,
      testKey: "hdl",
      source: "Optimal",
      rangeLow: 40,
      rangeHigh: 100,
      classification: "optimal",
      explanation: null,
    },
  ];
  const { markers: decorated, outOfRangeCount } = decorateMarkersWithContext(markers, ranges);
  assert.equal(decorated[0]!.outOfRangeFlag, "HIGH");
  assert.equal(decorated[0]!.flaggedBySource, true);
  assert.equal(decorated[1]!.outOfRangeFlag, null);
  assert.equal(decorated[1]!.flaggedBySource, false);
  assert.equal(outOfRangeCount, 1);
});

test("isValidAgeOfOnset rejects negative, >130, or non-integer", () => {
  assert.equal(isValidAgeOfOnset(50), true);
  assert.equal(isValidAgeOfOnset(0), true);
  assert.equal(isValidAgeOfOnset(130), true);
  assert.equal(isValidAgeOfOnset(-1), false);
  assert.equal(isValidAgeOfOnset(131), false);
  assert.equal(isValidAgeOfOnset(50.5), false);
  assert.equal(isValidAgeOfOnset("50"), false);
  assert.equal(isValidAgeOfOnset(null), false);
});

test("trimOrNull returns null for empty / non-string", () => {
  assert.equal(trimOrNull("  ok  "), "ok");
  assert.equal(trimOrNull(""), null);
  assert.equal(trimOrNull("   "), null);
  assert.equal(trimOrNull(null), null);
  assert.equal(trimOrNull(42), null);
});

function info(overrides: Partial<BloodMarkerInfo>): BloodMarkerInfo {
  return {
    id: 1,
    testKey: "ldl",
    displayName: "LDL Cholesterol",
    category: "Lipids",
    description: null,
    whyItMatters: null,
    higherMeans: null,
    lowerMeans: null,
    relatedMarkers: null,
    ...overrides,
  };
}

test("isRelatedMarker parses JSON relatedMarkers array safely", () => {
  assert.equal(isRelatedMarker(info({ relatedMarkers: '["ldl","hdl"]' }), "hdl"), true);
  assert.equal(isRelatedMarker(info({ relatedMarkers: '["ldl"]' }), "hdl"), false);
  assert.equal(isRelatedMarker(info({ relatedMarkers: null }), "hdl"), false);
  // Malformed JSON → no relations (does not throw).
  assert.equal(isRelatedMarker(info({ relatedMarkers: "{not-json" }), "hdl"), false);
  // Non-array JSON → no relations.
  assert.equal(isRelatedMarker(info({ relatedMarkers: '{"testKey":"hdl"}' }), "hdl"), false);
});
