/**
 * Behavioural tests for the smart-scale registry.
 *
 * Derived from Gadgetbridge's scale coordinators at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import {
  BLE_SCALE_MODELS,
  getBleScaleModel,
  matchBleScaleDevice,
  type BleScaleModelId,
} from "./ble-scale";

const EXPECTED_IDS: readonly BleScaleModelId[] = [
  "xiaomi_smart_scale_2",
  "xiaomi_body_composition_scale_2",
  "lefu_health_scale",
  "chipsea_qn_scale",
  "ge_fit_plus",
  "viatom_f8",
];

const IMPLEMENTED: readonly BleScaleModelId[] = [
  "xiaomi_smart_scale_2",
  "xiaomi_body_composition_scale_2",
  "lefu_health_scale",
];

test("the registry contains the six smart-scale models exactly once", () => {
  expect(BLE_SCALE_MODELS).toHaveLength(6);
  expect(new Set(BLE_SCALE_MODELS.map((model) => model.id)).size).toBe(6);
  expect(BLE_SCALE_MODELS.map((model) => model.id).sort()).toEqual([...EXPECTED_IDS].sort());
});

test("only the three implemented models declare a capture record", () => {
  for (const model of BLE_SCALE_MODELS) {
    expect(model.transportValidated, model.id).toBe(false);
    expect(model.displayName.length, model.id).toBeGreaterThan(0);
    if (IMPLEMENTED.includes(model.id)) {
      expect(model.records, model.id).toEqual(["weight_measurement"]);
      expect(model.serviceUuids.length, model.id).toBeGreaterThan(0);
    } else {
      expect(model.records, model.id).toEqual([]);
      expect(model.serviceUuids, model.id).toEqual([]);
    }
  }
});

test("getBleScaleModel resolves every registered id", () => {
  for (const model of BLE_SCALE_MODELS) expect(getBleScaleModel(model.id)).toBe(model);
});

test("model names match upstream full-string patterns case-insensitively", () => {
  const cases: readonly [string, BleScaleModelId][] = [
    ["MI SCALE2", "xiaomi_smart_scale_2"],
    ["mi scale2", "xiaomi_smart_scale_2"],
    ["MIBCS", "xiaomi_body_composition_scale_2"],
    ["mibfs", "xiaomi_body_composition_scale_2"],
    ["MIBFS", "xiaomi_body_composition_scale_2"],
    ["Health Scale", "lefu_health_scale"],
    ["health scale", "lefu_health_scale"],
    ["QN-Scale", "chipsea_qn_scale"],
    ["QN-Scale-1234", "chipsea_qn_scale"],
    ["qn-scale x", "chipsea_qn_scale"],
    ["Fit Plus", "ge_fit_plus"],
    ["fit plus", "ge_fit_plus"],
    ["F8", "viatom_f8"],
    ["f8", "viatom_f8"],
  ];
  for (const [name, id] of cases)
    expect(matchBleScaleDevice(name), name).toBe(getBleScaleModel(id) ?? null);
});

test("unimplemented models still match by name but carry no records", () => {
  const cases: readonly [string, BleScaleModelId][] = [
    ["QN-Scale-1234", "chipsea_qn_scale"],
    ["Fit Plus", "ge_fit_plus"],
    ["F8", "viatom_f8"],
  ];
  for (const [name, id] of cases) {
    const model = getBleScaleModel(id);
    expect(model?.records).toEqual([]);
    expect(matchBleScaleDevice(name)).toBe(model ?? null);
  }
});

test("full-string patterns reject extra text and unrelated names", () => {
  expect(matchBleScaleDevice("MI SCALE 2")).toBeNull();
  expect(matchBleScaleDevice("MIBFS-extra")).toBeNull();
  expect(matchBleScaleDevice("My Health Scale")).toBeNull();
  expect(matchBleScaleDevice("Polar H10")).toBeNull();
  expect(matchBleScaleDevice("")).toBeNull();
  expect(matchBleScaleDevice(null)).toBeNull();
  expect(matchBleScaleDevice(undefined)).toBeNull();
});
