/**
 * Behavioural tests for the Pebble registry.
 *
 * Derived from Gadgetbridge's Pebble family at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import {
  PEBBLE_BLE_MODELS,
  PEBBLE_MODELS,
  PEBBLE_SERVICE_UUID,
  getPebbleModel,
  isPebbleCandidateName,
  isPebbleBleOnly,
  matchPebbleDevice,
  pebbleModelByHardwareId,
  type PebbleModelId,
} from "./pebble";

const EXPECTED_IDS: readonly PebbleModelId[] = [
  "pebble_classic",
  "pebble_steel",
  "pebble_time",
  "pebble_time_steel",
  "pebble_time_round",
  "pebble_classic_2",
  "pebble_2_duo",
  "pebble_time_2",
];

test("the registry contains the eight Pebble models exactly once", () => {
  expect(PEBBLE_MODELS).toHaveLength(8);
  expect(new Set(PEBBLE_MODELS.map((model) => model.id)).size).toBe(8);
  expect(PEBBLE_MODELS.map((model) => model.id).sort()).toEqual([...EXPECTED_IDS].sort());
});

test("only the BLE Pebble models advertise capture; Duo has no heart rate", () => {
  const ble = PEBBLE_MODELS.filter((model) => model.bleOnly);
  expect(ble.map((model) => model.id).sort()).toEqual([
    "pebble_2_duo",
    "pebble_classic_2",
    "pebble_time_2",
  ]);
  expect(PEBBLE_BLE_MODELS).toHaveLength(3);
  for (const model of PEBBLE_MODELS) {
    expect(model.transportValidated, model.id).toBe(false);
    expect(model.sourceFiles.length, model.id).toBeGreaterThan(0);
    expect(isPebbleBleOnly(model), model.id).toBe(model.bleOnly);
    if (model.bleOnly) {
      expect(model.records, model.id).toEqual(
        model.hasHrm ? ["steps", "sleep_session", "heart_rate"] : ["steps", "sleep_session"],
      );
      expect(model.sync, model.id).toBe(true);
      expect(model.serviceUuids, model.id).toEqual([PEBBLE_SERVICE_UUID]);
      expect(model.hasHealth, model.id).toBe(true);
    } else {
      expect(model.records, model.id).toEqual([]);
      expect(model.sync, model.id).toBe(false);
      expect(model.serviceUuids, model.id).toEqual([]);
    }
  }
});

test("the Bluetooth Classic generation has no health capability on APLITE", () => {
  for (const id of ["pebble_classic", "pebble_steel"] as const) {
    expect(getPebbleModel(id)?.hasHealth, id).toBe(false);
    expect(getPebbleModel(id)?.hasHrm, id).toBe(false);
  }
  for (const id of ["pebble_time", "pebble_time_steel", "pebble_time_round"] as const) {
    expect(getPebbleModel(id)?.hasHealth, id).toBe(true);
    expect(getPebbleModel(id)?.hasHrm, id).toBe(false);
  }
  // FLINT (Pebble 2 Duo) has health but no heart-rate monitor.
  expect(getPebbleModel("pebble_2_duo")?.hasHrm).toBe(false);
  expect(getPebbleModel("pebble_classic_2")?.hasHrm).toBe(true);
  expect(getPebbleModel("pebble_time_2")?.hasHrm).toBe(true);
});

test("advertised names resolve to the right model", () => {
  const cases: readonly [string, PebbleModelId][] = [
    ["Pebble", "pebble_classic"],
    ["Pebble-LE 1A2B", "pebble_classic"],
    ["Pebble Steel", "pebble_steel"],
    ["Pebble Time", "pebble_time"],
    ["Pebble Time LE 1A2B", "pebble_time"],
    ["Pebble Time Steel", "pebble_time_steel"],
    ["Pebble Time Round", "pebble_time_round"],
    ["Pebble Time Round LE 1A2B", "pebble_time_round"],
  ];
  for (const [name, id] of cases) expect(matchPebbleDevice(name)?.id, name).toBe(id);
  expect(matchPebbleDevice("Pebble 1A2B")).toBeNull();
  expect(matchPebbleDevice("Pebble 1A2B", 15)?.id).toBe("pebble_2_duo");
  expect(matchPebbleDevice("Pebble 1A2B", 19)).toBeNull();
});

test("generic Pebble advertisements are candidates without false identity", () => {
  for (const name of ["Pebble", "Pebble 1A2B", "Pebble Time LE 1A2B", "Pebble Mystery"])
    expect(isPebbleCandidateName(name), name).toBe(true);
  expect(isPebbleCandidateName("Amazfit Helio Strap")).toBe(false);
});

test("the hardware revision resolves the exact model", () => {
  const cases: readonly [number, PebbleModelId][] = [
    [1, "pebble_classic"],
    [5, "pebble_classic"],
    [255, "pebble_classic"],
    [8, "pebble_time"],
    [11, "pebble_time_round"],
    [14, "pebble_classic_2"],
    [15, "pebble_2_duo"],
    [18, "pebble_time_2"],
    [249, "pebble_time_2"],
  ];
  for (const [hardwareId, id] of cases)
    expect(pebbleModelByHardwareId(hardwareId)?.id, String(hardwareId)).toBe(id);
  expect(pebbleModelByHardwareId(0)).toBeNull();
  expect(pebbleModelByHardwareId(999)).toBeNull();
  // The hardware id wins over an ambiguous name.
  expect(matchPebbleDevice("Pebble 1A2B", 15)?.id).toBe("pebble_2_duo");
  expect(matchPebbleDevice("Pebble 1A2B", 18)?.id).toBe("pebble_time_2");
});

test("names from other families and partial matches are rejected", () => {
  for (const name of [
    "Pebble 2 Duo",
    "Pebble XXXX",
    "pebble 1a2b",
    "Pebble-LE",
    "Pebble Time LE",
    "Pebble Time 2",
    "Pebble Round 2",
    "R02_1234",
    "Mi Smart Band 9",
    "",
  ])
    expect(matchPebbleDevice(name), name).toBeNull();
  expect(matchPebbleDevice(null)).toBeNull();
  expect(matchPebbleDevice(undefined)).toBeNull();
});

test("codename prefixes and hardware ids come from the platform table", () => {
  expect(getPebbleModel("pebble_time")?.codenamePrefixes).toEqual(["snowy"]);
  expect(getPebbleModel("pebble_time_round")?.codenamePrefixes).toEqual(["spalding"]);
  expect(getPebbleModel("pebble_classic_2")?.codenamePrefixes).toEqual(["silk"]);
  expect(getPebbleModel("pebble_2_duo")?.codenamePrefixes).toEqual(["asterix"]);
  expect(getPebbleModel("pebble_time_2")?.codenamePrefixes).toEqual(["robert", "obelix"]);
  expect(getPebbleModel("pebble_classic")?.codenamePrefixes).toEqual([]);
  // Every hardware id in the upstream registry maps to exactly one platform.
  const seen = new Map<number, string>();
  for (const model of PEBBLE_MODELS) {
    for (const id of model.hardwareIds) {
      const existing = seen.get(id);
      if (existing) expect(existing, String(id)).toBe(model.platform);
      else seen.set(id, model.platform);
    }
  }
  expect(seen.size).toBe(29);
});

test("getPebbleModel returns undefined for unknown ids", () => {
  expect(getPebbleModel("pebble_classic_2")?.displayName).toBe("Pebble Classic 2");
  expect(getPebbleModel("pebble_round_2" as PebbleModelId)).toBeUndefined();
});

test("display names are unique", () => {
  expect(new Set(PEBBLE_MODELS.map((model) => model.displayName)).size).toBe(8);
});
