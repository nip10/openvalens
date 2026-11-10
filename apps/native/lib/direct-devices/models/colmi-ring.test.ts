/**
 * Behavioural tests for the Colmi / Yawell ring registry.
 *
 * Derived from Gadgetbridge's Yawell ring family at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import {
  COLMI_RING_MODELS,
  COLMI_V1_NOTIFY_UUID,
  COLMI_V1_SERVICE_UUID,
  COLMI_V1_WRITE_UUID,
  COLMI_V2_COMMAND_UUID,
  COLMI_V2_NOTIFY_UUID,
  COLMI_V2_SERVICE_UUID,
  getColmiRingModel,
  matchColmiRingDevice,
  type ColmiRingModelId,
} from "./colmi-ring";

const EXPECTED_IDS: readonly ColmiRingModelId[] = [
  "colmi_r02",
  "colmi_r03",
  "colmi_r06",
  "colmi_r07",
  "colmi_r09",
  "colmi_r10",
  "colmi_r12",
  "yawell_r05",
  "yawell_r10",
  "yawell_r11",
  "yawell_ai_health_watchpad",
];

test("the registry contains the eleven ring models exactly once", () => {
  expect(COLMI_RING_MODELS).toHaveLength(11);
  expect(new Set(COLMI_RING_MODELS.map((model) => model.id)).size).toBe(11);
  expect(COLMI_RING_MODELS.map((model) => model.id).sort()).toEqual([...EXPECTED_IDS].sort());
});

test("every ring model declares the same capture records and services", () => {
  for (const model of COLMI_RING_MODELS) {
    expect(model.transportValidated, model.id).toBe(false);
    expect(model.displayName.length, model.id).toBeGreaterThan(0);
    expect(model.records, model.id).toEqual(["steps_interval", "sleep_session", "heart_rate"]);
    expect(model.serviceUuids, model.id).toEqual([COLMI_V1_SERVICE_UUID, COLMI_V2_SERVICE_UUID]);
    expect(model.sourceFiles.length, model.id).toBeGreaterThan(0);
  }
});

test("getColmiRingModel resolves every registered id", () => {
  for (const model of COLMI_RING_MODELS) expect(getColmiRingModel(model.id)).toBe(model);
});

test("advertised names match the upstream full-string patterns", () => {
  const cases: readonly [string, ColmiRingModelId][] = [
    ["R02_1A2B", "colmi_r02"],
    ["R03_FFFF", "colmi_r03"],
    ["R06_0001", "colmi_r06"],
    ["COLMI R07_1234", "colmi_r07"],
    ["R09_ABCD", "colmi_r09"],
    ["COLMI R10_1234", "colmi_r10"],
    ["COLMI R12_9F3C", "colmi_r12"],
    ["R05_1A2B", "yawell_r05"],
    ["R10_ABCD", "yawell_r10"],
    ["R11_1234", "yawell_r11"],
    ["R11C_1234", "yawell_r11"],
    ["Y27_00FF", "yawell_ai_health_watchpad"],
  ];
  for (const [name, id] of cases)
    expect(matchColmiRingDevice(name), name).toBe(getColmiRingModel(id) ?? null);
});

test("patterns are case-sensitive like upstream Matcher.matches()", () => {
  // Lowercase prefixes are not upstream matches.
  expect(matchColmiRingDevice("r02_1A2B")).toBeNull();
  expect(matchColmiRingDevice("colmi r07_1234")).toBeNull();
  // The Yawell patterns require an uppercase hex suffix.
  expect(matchColmiRingDevice("R05_1a2b")).toBeNull();
  // R07/R10/R12 require the spelled-out COLMI prefix.
  expect(matchColmiRingDevice("R07_1234")).toBeNull();
  expect(matchColmiRingDevice("R12_1234")).toBeNull();
  expect(matchColmiRingDevice("R11X_1234")).toBeNull();
});

test("full-string patterns reject extra text and unrelated names", () => {
  expect(matchColmiRingDevice("R02")).toBeNull();
  expect(matchColmiRingDevice("R05_1A2")).toBeNull();
  expect(matchColmiRingDevice("Polar H10 ABC123")).toBeNull();
  expect(matchColmiRingDevice("MI SCALE2")).toBeNull();
  expect(matchColmiRingDevice("")).toBeNull();
  expect(matchColmiRingDevice(null)).toBeNull();
  expect(matchColmiRingDevice(undefined)).toBeNull();
});

test("the ring UUIDs match the upstream constants", () => {
  expect(COLMI_V1_SERVICE_UUID).toBe("6e40fff0-b5a3-f393-e0a9-e50e24dcca9e");
  expect(COLMI_V1_WRITE_UUID).toBe("6e400002-b5a3-f393-e0a9-e50e24dcca9e");
  expect(COLMI_V1_NOTIFY_UUID).toBe("6e400003-b5a3-f393-e0a9-e50e24dcca9e");
  expect(COLMI_V2_SERVICE_UUID).toBe("de5bf728-d711-4e47-af26-65e3012a5dc7");
  expect(COLMI_V2_COMMAND_UUID).toBe("de5bf72a-d711-4e47-af26-65e3012a5dc7");
  expect(COLMI_V2_NOTIFY_UUID).toBe("de5bf729-d711-4e47-af26-65e3012a5dc7");
});
