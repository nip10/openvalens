/**
 * Behavioural tests for the FitPro registry.
 *
 * Derived from Gadgetbridge's FitPro family at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import {
  FITPRO_MODELS,
  FITPRO_NOTIFY_UUID,
  FITPRO_SERVICE_UUID,
  FITPRO_WRITE_UUID,
  getFitProModel,
  matchFitProDevice,
  type FitProModelId,
} from "./fitpro";

const EXPECTED_IDS: readonly FitProModelId[] = [
  "colacao_2021",
  "colacao_2023",
  "fitpro_braz7harry",
  "fitpro_d13_116plus",
  "fitpro_fit_1900",
  "fitpro_lh716",
  "fitpro_m4",
  "fitpro_m6",
  "fitpro_series_11",
  "fitpro_sunset_6",
  "fitpro_watch_7",
  "fitpro_y68",
  "fitpro_ybw_05",
];

test("the registry contains the thirteen FitPro models exactly once", () => {
  expect(FITPRO_MODELS).toHaveLength(13);
  expect(new Set(FITPRO_MODELS.map((model) => model.id)).size).toBe(13);
  expect(FITPRO_MODELS.map((model) => model.id).sort()).toEqual([...EXPECTED_IDS].sort());
});

test("every model declares the three record kinds on the cca9d UART service", () => {
  for (const model of FITPRO_MODELS) {
    expect(model.records, model.id).toEqual(["steps_interval", "sleep_session", "heart_rate"]);
    expect(model.serviceUuids, model.id).toEqual([FITPRO_SERVICE_UUID]);
    expect(model.transportValidated, model.id).toBe(false);
    expect(model.sourceFiles.length, model.id).toBeGreaterThan(0);
  }
  // The non-standard suffix is the whole point: the usual Nordic UART service
  // ends in cca9e.
  expect(FITPRO_SERVICE_UUID.endsWith("cca9d")).toBe(true);
  expect(FITPRO_WRITE_UUID.endsWith("cca9d")).toBe(true);
  expect(FITPRO_NOTIFY_UUID.endsWith("cca9d")).toBe(true);
});

test("advertised names resolve to the right model", () => {
  const cases: readonly [string, FitProModelId][] = [
    ["M6", "fitpro_m6"],
    ["M6 Pro", "fitpro_m6"],
    ["M4", "fitpro_m4"],
    ["M4 Max", "fitpro_m4"],
    ["LH716", "fitpro_lh716"],
    ["716", "fitpro_lh716"],
    ["Sunset 6", "fitpro_sunset_6"],
    ["Watch7", "fitpro_watch_7"],
    ["Fit1900", "fitpro_fit_1900"],
    ["YBW-05", "fitpro_ybw_05"],
    ["SERIES 11", "fitpro_series_11"],
    ["BRAZ-7HAR", "fitpro_braz7harry"],
    ["D13 116Plus", "fitpro_d13_116plus"],
    ["Y68", "fitpro_y68"],
    ["ColaCao21", "colacao_2021"],
    ["ColaCao23", "colacao_2023"],
  ];
  for (const [name, id] of cases) expect(matchFitProDevice(name)?.id, name).toBe(id);
});

test("names from other families and partial matches are rejected", () => {
  for (const name of [
    "R02_1234",
    "P80",
    "Mi Smart Band 9",
    "ColaCao 21",
    "ColaCao21x",
    "m6",
    "watch7",
    "Sunset6",
    "M",
    "",
  ])
    expect(matchFitProDevice(name), name).toBeNull();
  expect(matchFitProDevice(null)).toBeNull();
  expect(matchFitProDevice(undefined)).toBeNull();
});

test("the ColaCao models disable heart-rate measurement like upstream", () => {
  for (const id of ["colacao_2021", "colacao_2023"] as const) {
    expect(getFitProModel(id)?.heartRateMeasurement, id).toBe(false);
    expect(
      getFitProModel(id)?.sourceFiles.some((file) => file.includes("/colacao/")),
      id,
    ).toBe(true);
  }
  for (const id of ["fitpro_m6", "fitpro_lh716", "fitpro_ybw_05"] as const)
    expect(getFitProModel(id)?.heartRateMeasurement, id).toBe(true);
});

test("only the two uncatalogued-by-coordinator models use a catalog name pattern", () => {
  const catalog = FITPRO_MODELS.filter((model) => model.namePatternSource === "catalog");
  expect(catalog.map((model) => model.id).sort()).toEqual(["fitpro_d13_116plus", "fitpro_y68"]);
  for (const model of FITPRO_MODELS)
    expect(model.namePatternSource, model.id).toBe(
      model.id === "fitpro_d13_116plus" || model.id === "fitpro_y68" ? "catalog" : "coordinator",
    );
});

test("getFitProModel returns undefined for unknown ids", () => {
  expect(getFitProModel("fitpro_m6")?.displayName).toBe("FitPro M6");
  expect(getFitProModel("moyoung_l70" as FitProModelId)).toBeUndefined();
});

test("display names are unique", () => {
  expect(new Set(FITPRO_MODELS.map((model) => model.displayName)).size).toBe(13);
});
