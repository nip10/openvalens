/**
 * Behavioural tests for the Casio registry.
 *
 * Derived from Gadgetbridge's Casio family at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import {
  CASIO_MODELS,
  CASIO_WATCH_FEATURES_SERVICE_UUID,
  casioHasStepsPath,
  getCasioModel,
  matchCasioDevice,
  type CasioModelId,
} from "./casio";

const EXPECTED_IDS: readonly CasioModelId[] = [
  "casio_ecb-s100",
  "casio_gb-5600b",
  "casio_gb-6900b",
  "casio_gb-x6900b",
  "casio_stb-1000",
  "casio_gbx-100",
  "casio_gbd-100",
  "casio_gbd-200",
  "casio_gbd-h1000",
  "casio_gw-b5600",
  "casio_gmw-b5000",
  "casio_gg-b100",
];

/** Models whose upstream support is a GATT server: no data path at all. */
const SERVER_ROLE_IDS: readonly CasioModelId[] = [
  "casio_gb-5600b",
  "casio_gb-6900b",
  "casio_gb-x6900b",
  "casio_stb-1000",
];

/** Client-role models whose upstream support implements no recorded-data fetch. */
const CLIENT_WITHOUT_FETCH_IDS: readonly CasioModelId[] = [
  "casio_ecb-s100",
  "casio_gw-b5600",
  "casio_gmw-b5000",
];

test("the registry contains the twelve Casio models exactly once", () => {
  expect(CASIO_MODELS).toHaveLength(12);
  expect(new Set(CASIO_MODELS.map((model) => model.id)).size).toBe(12);
  expect(CASIO_MODELS.map((model) => model.id).sort()).toEqual([...EXPECTED_IDS].sort());
});

test("every model is unvalidated and bound to the Watch Features service", () => {
  for (const model of CASIO_MODELS) {
    expect(model.transportValidated, model.id).toBe(false);
    expect(model.displayName.length, model.id).toBeGreaterThan(0);
    expect(model.serviceUuids, model.id).toEqual([CASIO_WATCH_FEATURES_SERVICE_UUID]);
    expect(model.sourceFiles.length, model.id).toBeGreaterThan(0);
    expect(model.sourceFiles.some((file) => file.includes("CasioConstants.java"))).toBe(true);
  }
});

test("getCasioModel resolves every registered id", () => {
  for (const model of CASIO_MODELS) expect(getCasioModel(model.id)).toBe(model);
});

test("GATT-server-role models have no records and no steps source", () => {
  for (const id of SERVER_ROLE_IDS) {
    const model = getCasioModel(id)!;
    expect(model.role, id).toBe("server");
    expect(model.records, id).toEqual([]);
    expect(model.stepsSource, id).toBeNull();
    expect(casioHasStepsPath(model), id).toBe(false);
  }
});

test("client-role models without an upstream fetch also have no records", () => {
  for (const id of CLIENT_WITHOUT_FETCH_IDS) {
    const model = getCasioModel(id)!;
    expect(model.role, id).toBe("client");
    expect(model.records, id).toEqual([]);
    expect(model.stepsSource, id).toBeNull();
    expect(casioHasStepsPath(model), id).toBe(false);
  }
});

test("the five models with an upstream steps fetch claim steps_interval only", () => {
  const expected: readonly [CasioModelId, "hourly-tlv" | "life-log", boolean][] = [
    ["casio_gbx-100", "hourly-tlv", true],
    ["casio_gbd-100", "hourly-tlv", true],
    ["casio_gbd-h1000", "hourly-tlv", true],
    ["casio_gbd-200", "hourly-tlv", true],
    ["casio_gg-b100", "life-log", false],
  ];
  for (const [id, source, xor] of expected) {
    const model = getCasioModel(id)!;
    expect(model.role, id).toBe("client");
    expect(model.records, id).toEqual(["steps_interval"]);
    expect(model.stepsSource, id).toBe(source);
    expect(model.stepPayloadXor, id).toBe(xor);
    expect(casioHasStepsPath(model), id).toBe(true);
  }
});

test("no model claims heart rate or sleep", () => {
  for (const model of CASIO_MODELS) {
    expect(model.records, model.id).not.toContain("heart_rate");
    expect(model.records, model.id).not.toContain("sleep_session");
  }
});

test("advertised names match the upstream full-string patterns", () => {
  const cases: readonly [string, CasioModelId][] = [
    ["CASIO ECB-S100", "casio_ecb-s100"],
    ["CASIO GB-5600B-1A", "casio_gb-5600b"],
    ["CASIO GB-6900B-1", "casio_gb-6900b"],
    ["CASIO GB-X6900B", "casio_gb-x6900b"],
    ["CASIO STB-1000-1", "casio_stb-1000"],
    ["CASIO GBX-100", "casio_gbx-100"],
    ["CASIO GBD-100", "casio_gbd-100"],
    ["CASIO GBD-200-1", "casio_gbd-200"],
    ["CASIO GBD-H1000", "casio_gbd-h1000"],
    ["CASIO GW-B5600", "casio_gw-b5600"],
    ["CASIO GMW-B5000", "casio_gmw-b5000"],
    ["CASIO GG-B100-1", "casio_gg-b100"],
  ];
  for (const [name, id] of cases) expect(matchCasioDevice(name)?.id, name).toBe(id);
});

test("name matching is full-string and case-sensitive, like upstream matches()", () => {
  // Upstream `CASIO GW-B5600` has no trailing wildcard.
  expect(matchCasioDevice("CASIO GW-B5600-2ER")).toBeNull();
  // Upstream `CASIO.*(GBX-100|GBD-100|GBD-H1000)` has no trailing wildcard
  // either, so a suffixed name does not match.
  expect(matchCasioDevice("CASIO GBX-100-1")).toBeNull();
  expect(matchCasioDevice("casio gbx-100")).toBeNull();
  expect(matchCasioDevice("Not a Casio")).toBeNull();
  expect(matchCasioDevice("")).toBeNull();
  expect(matchCasioDevice(null)).toBeNull();
  expect(matchCasioDevice(undefined)).toBeNull();
});

test("the GB-6900B family carries the Bluetooth-toggle pairing hint", () => {
  for (const id of SERVER_ROLE_IDS) {
    expect(getCasioModel(id)!.pairingHint, id).toContain("Bluetooth");
  }
  expect(getCasioModel("casio_gbx-100")!.pairingHint).toBeNull();
});

test("per-model quirks are recorded from upstream", () => {
  expect(getCasioModel("casio_gbd-200")!.mainMenuResync).toBe(true);
  expect(getCasioModel("casio_gbx-100")!.mainMenuResync).toBe(false);
  for (const id of ["casio_ecb-s100", "casio_gw-b5600", "casio_gmw-b5000"] as const)
    expect(getCasioModel(id)!.reconnectOnMissingCharacteristics, id).toBe(true);
  expect(getCasioModel("casio_gbx-100")!.reconnectOnMissingCharacteristics).toBe(false);
});

test("provenance points at the upstream coordinator and support files", () => {
  const gbd200 = getCasioModel("casio_gbd-200")!;
  expect(gbd200.sourceFiles).toContain(
    "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/casio/gbd200/CasioGBD200DeviceCoordinator.java",
  );
  expect(gbd200.sourceFiles).toContain(
    "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/casio/gbd200/CasioGBD200DeviceSupport.java",
  );
  expect(gbd200.sourceFiles).toContain(
    "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/casio/gbd200/FetchStepCountDataOperation.java",
  );
  const ggb100 = getCasioModel("casio_gg-b100")!;
  expect(ggb100.sourceFiles).toContain(
    "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/casio/ggb100/FetchStepCountDataOperation.java",
  );
  // Server-role models have no fetch operation to point at.
  const gb6900 = getCasioModel("casio_gb-6900b")!;
  expect(gb6900.sourceFiles.some((file) => file.includes("FetchStepCountDataOperation"))).toBe(
    false,
  );
});
