/**
 * Behavioural tests for the generic Bluetooth GATT sensor registry.
 *
 * The registry is derived from Gadgetbridge's generic coordinators at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import {
  BLE_GATT_MODELS,
  getBleGattModel,
  matchBleGattDevice,
  normalizeServiceUuid,
  type BleGattModelId,
} from "./ble-gatt";

const EXPECTED_IDS: readonly BleGattModelId[] = [
  "generic_heart_rate_sensor",
  "polar_h10",
  "polar_h9",
  "coospo_h6",
  "coospo_h9z",
  "coospo_hw807",
  "coospo_hw9",
  "generic_blood_pressure_monitor",
  "beurer_bm59",
  "beurer_bm69",
  "sanitas_sbm67",
  "generic_health_thermometer",
  "femometer_vinca_2",
];

test("the registry contains the 13 generic GATT models exactly once", () => {
  expect(BLE_GATT_MODELS).toHaveLength(13);
  expect(new Set(BLE_GATT_MODELS.map((model) => model.id)).size).toBe(13);
  expect(BLE_GATT_MODELS.map((model) => model.id).sort()).toEqual([...EXPECTED_IDS].sort());
  expect(BLE_GATT_MODELS.filter((model) => model.generic)).toHaveLength(3);
});

test("every model is unvalidated and emits no steps", () => {
  for (const model of BLE_GATT_MODELS) {
    expect(model.displayName.length, model.id).toBeGreaterThan(0);
    expect(model.transportValidated, model.id).toBe(false);
    expect(model.records, model.id).not.toContain("steps");
    expect(model.serviceUuids.length, model.id).toBeGreaterThan(0);
    expect(model.sourceFiles.length, model.id).toBeGreaterThan(0);
  }
  expect(
    BLE_GATT_MODELS.filter((model) => model.generic).every((m) => m.bleNamePatterns.length === 0),
  ).toBe(true);
  expect(
    BLE_GATT_MODELS.filter((model) => !model.generic).every((m) => m.bleNamePatterns.length > 0),
  ).toBe(true);
});

test("getBleGattModel resolves every registered id", () => {
  for (const model of BLE_GATT_MODELS) expect(getBleGattModel(model.id)).toBe(model);
});

test("named models match their upstream full-string names", () => {
  const cases: readonly [string, BleGattModelId][] = [
    ["Polar H10", "polar_h10"],
    ["Polar H10 ABC123", "polar_h10"],
    ["Polar H9", "polar_h9"],
    ["Polar H9 ABC", "polar_h9"],
    ["H6M 12345", "coospo_h6"],
    ["H9Z 12345", "coospo_h9z"],
    ["HW807", "coospo_hw807"],
    ["COOSPO HW807", "coospo_hw807"],
    ["HW9 12345", "coospo_hw9"],
    ["BM59", "beurer_bm59"],
    ["BM59 something", "beurer_bm59"],
    ["BM69", "beurer_bm69"],
    ["BPM Smart", "sanitas_sbm67"],
    ["SBM67", "sanitas_sbm67"],
    ["BM-Vinca2", "femometer_vinca_2"],
  ];
  for (const [name, id] of cases)
    expect(matchBleGattDevice(name, []), name).toBe(getBleGattModel(id) ?? null);
});

test("name matching is case-sensitive, like upstream Matcher.matches", () => {
  expect(matchBleGattDevice("polar h10", [])).toBeNull();
  expect(matchBleGattDevice("POLAR H10", [])).toBeNull();
  expect(matchBleGattDevice("bm59", [])).toBeNull();
  expect(matchBleGattDevice("bm-vinca2", [])).toBeNull();
});

test("full-string patterns reject extra text, while prefix patterns accept it", () => {
  expect(matchBleGattDevice("My Polar H10", [])).toBeNull();
  expect(matchBleGattDevice("H6M 1234", [])).toBeNull();
  expect(matchBleGattDevice("H6M 123456", [])).toBeNull();
  expect(matchBleGattDevice("Polar H9 ABC DEF", [])).toBeNull();
  // Beurer uses an anchored prefix upstream, not a full-string match.
  expect(matchBleGattDevice("BM59-extra", [])).toBe(getBleGattModel("beurer_bm59") ?? null);
});

test("generic models match by advertised service UUID only when no named model matched", () => {
  expect(matchBleGattDevice("Random device", ["180d"])).toBe(
    getBleGattModel("generic_heart_rate_sensor") ?? null,
  );
  expect(matchBleGattDevice(null, ["00001810-0000-1000-8000-00805f9b34fb"])).toBe(
    getBleGattModel("generic_blood_pressure_monitor") ?? null,
  );
  expect(matchBleGattDevice("Random device", ["1809"])).toBe(
    getBleGattModel("generic_health_thermometer") ?? null,
  );
  // A named model always wins over the generic UUID fallback.
  expect(matchBleGattDevice("Polar H10 ABC", ["180d"])).toBe(getBleGattModel("polar_h10") ?? null);
});

test("unknown names and service UUIDs return null", () => {
  expect(matchBleGattDevice("Random device", [])).toBeNull();
  expect(matchBleGattDevice("Random device", undefined)).toBeNull();
  expect(matchBleGattDevice("Random device", ["180f"])).toBeNull();
  expect(matchBleGattDevice(undefined, null)).toBeNull();
  expect(matchBleGattDevice("", ["180f"])).toBeNull();
});

test("normalizeServiceUuid expands short and 0x-prefixed UUIDs", () => {
  expect(normalizeServiceUuid("180d")).toBe("0000180d-0000-1000-8000-00805f9b34fb");
  expect(normalizeServiceUuid("0x180D")).toBe("0000180d-0000-1000-8000-00805f9b34fb");
  expect(normalizeServiceUuid("0000180D-0000-1000-8000-00805F9B34FB")).toBe(
    "0000180d-0000-1000-8000-00805f9b34fb",
  );
});
