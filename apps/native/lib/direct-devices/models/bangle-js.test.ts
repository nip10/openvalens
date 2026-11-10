/**
 * Behavioural tests for the Bangle.js / Espruino model registry.
 *
 * Derived from Gadgetbridge's Bangle.js support at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import {
  BANGLE_JS_MODELS,
  BANGLE_JS_RX_UUID,
  BANGLE_JS_SERVICE_UUID,
  BANGLE_JS_TX_UUID,
  getBangleJsModel,
  matchBangleJsDevice,
  type BangleJsModelId,
} from "./bangle-js";

const EXPECTED_IDS: readonly BangleJsModelId[] = ["bangle_js_1", "bangle_js_2"];

test("the registry contains the two Bangle.js models exactly once", () => {
  expect(BANGLE_JS_MODELS).toHaveLength(2);
  expect(new Set(BANGLE_JS_MODELS.map((model) => model.id)).size).toBe(2);
  expect(BANGLE_JS_MODELS.map((model) => model.id).sort()).toEqual([...EXPECTED_IDS].sort());
});

test("every model declares the same capture records and services", () => {
  for (const model of BANGLE_JS_MODELS) {
    expect(model.transportValidated, model.id).toBe(false);
    expect(model.displayName.length, model.id).toBeGreaterThan(0);
    expect(model.records, model.id).toEqual(["steps_interval", "heart_rate"]);
    expect(model.serviceUuids, model.id).toEqual([BANGLE_JS_SERVICE_UUID]);
    expect(model.sourceFiles.length, model.id).toBeGreaterThan(0);
  }
});

test("getBangleJsModel resolves every registered id", () => {
  for (const model of BANGLE_JS_MODELS) expect(getBangleJsModel(model.id)).toBe(model);
});

test("advertised names match the upstream full-string pattern", () => {
  expect(matchBangleJsDevice("Bangle.js 2")).toBe(getBangleJsModel("bangle_js_2") ?? null);
  expect(matchBangleJsDevice("Bangle.js 1")).toBe(getBangleJsModel("bangle_js_1") ?? null);
  expect(matchBangleJsDevice("Bangle.js")).toBe(getBangleJsModel("bangle_js_1") ?? null);
  expect(matchBangleJsDevice("Bangle.js 1234")).toBe(getBangleJsModel("bangle_js_1") ?? null);
  // A name that only carries the model number selects the second revision.
  expect(matchBangleJsDevice("Bangle.js 2 A1B2")).toBe(getBangleJsModel("bangle_js_2") ?? null);
});

test("patterns are full-string and case-sensitive like upstream Matcher.matches()", () => {
  expect(matchBangleJsDevice("My Bangle.js 2")).toBeNull();
  expect(matchBangleJsDevice("bangle.js 2")).toBeNull();
  expect(matchBangleJsDevice("BangleJS 2")).toBeNull();
  expect(matchBangleJsDevice("Pixl.js")).toBeNull();
  expect(matchBangleJsDevice("Puck.js")).toBeNull();
  expect(matchBangleJsDevice("Espruino")).toBeNull();
  expect(matchBangleJsDevice("")).toBeNull();
  expect(matchBangleJsDevice(null)).toBeNull();
  expect(matchBangleJsDevice(undefined)).toBeNull();
});

test("the Nordic UART service is accepted as a nameless fallback", () => {
  expect(matchBangleJsDevice(null, [BANGLE_JS_SERVICE_UUID])).toBe(
    getBangleJsModel("bangle_js_1") ?? null,
  );
  expect(matchBangleJsDevice("Unnamed", [BANGLE_JS_SERVICE_UUID.toUpperCase()])).toBe(
    getBangleJsModel("bangle_js_1") ?? null,
  );
  // A name match always wins over the service fallback.
  expect(matchBangleJsDevice("Bangle.js 2", [BANGLE_JS_SERVICE_UUID])).toBe(
    getBangleJsModel("bangle_js_2") ?? null,
  );
  // Unrelated services do not match.
  expect(matchBangleJsDevice(null, ["0000180d-0000-1000-8000-00805f9b34fb"])).toBeNull();
  expect(matchBangleJsDevice(null, [])).toBeNull();
});

test("the Nordic UART UUIDs match the upstream constants", () => {
  expect(BANGLE_JS_SERVICE_UUID).toBe("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
  expect(BANGLE_JS_TX_UUID).toBe("6e400002-b5a3-f393-e0a9-e50e24dcca9e");
  expect(BANGLE_JS_RX_UUID).toBe("6e400003-b5a3-f393-e0a9-e50e24dcca9e");
});
