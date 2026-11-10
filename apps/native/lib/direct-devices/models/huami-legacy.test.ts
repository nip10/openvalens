/**
 * Behavioural tests for the legacy Huami model registry.
 *
 * Derived from Gadgetbridge's Huami family at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import {
  HUAMI_LEGACY_MODELS,
  HUAMI_SERVICE_UUID,
  compareHuamiFirmwareVersion,
  getHuamiLegacyModel,
  matchHuamiLegacyDevice,
  resolveHuamiSampleSize,
  type HuamiLegacyModelId,
} from "./huami-legacy";

const EXPECTED_IDS: readonly HuamiLegacyModelId[] = [
  "amazfit_bip",
  "amazfit_bip_lite",
  "amazfit_bip_s",
  "amazfit_bip_s_lite",
  "amazfit_bip_u",
  "amazfit_bip_u_pro",
  "amazfit_bip_3",
  "amazfit_bip_3_pro",
  "amazfit_cor",
  "amazfit_cor_2",
  "amazfit_gtr",
  "amazfit_gtr_lite",
  "amazfit_gtr_2",
  "amazfit_gtr_2e",
  "amazfit_gts",
  "amazfit_gts_2",
  "amazfit_gts_2e",
  "amazfit_gts_2_mini",
  "amazfit_neo",
  "amazfit_pop",
  "amazfit_pop_pro",
  "amazfit_trex",
  "amazfit_trex_pro",
  "amazfit_verge_lite",
  "amazfit_x",
  "zepp_e",
  "amazfit_band_5",
  "xiaomi_mi_band_2",
  "xiaomi_mi_band_2_hrx",
  "xiaomi_mi_band_3",
  "xiaomi_mi_band_4",
  "xiaomi_mi_band_5",
  "xiaomi_mi_band_6",
];

test("the registry contains the 33 legacy models exactly once", () => {
  expect(HUAMI_LEGACY_MODELS).toHaveLength(33);
  expect(new Set(HUAMI_LEGACY_MODELS.map((model) => model.id)).size).toBe(33);
  expect(HUAMI_LEGACY_MODELS.map((model) => model.id).sort()).toEqual([...EXPECTED_IDS].sort());
});

test("every model declares the same records and services and stays unvalidated", () => {
  for (const model of HUAMI_LEGACY_MODELS) {
    expect(model.transportValidated, model.id).toBe(false);
    expect(model.displayName.length, model.id).toBeGreaterThan(0);
    expect(model.records, model.id).toEqual(["steps", "heart_rate", "sleep_session"]);
    expect(model.serviceUuids, model.id).toContain(HUAMI_SERVICE_UUID);
    expect(model.sourceFiles.length, model.id).toBeGreaterThan(0);
  }
});

test("getHuamiLegacyModel resolves every registered id", () => {
  for (const model of HUAMI_LEGACY_MODELS) expect(getHuamiLegacyModel(model.id)).toBe(model);
});

test("advertised names match the upstream full-string patterns", () => {
  const cases: readonly [string, HuamiLegacyModelId][] = [
    ["Amazfit Bip Watch", "amazfit_bip"],
    ["Amazfit Bip Lite", "amazfit_bip_lite"],
    ["Amazfit Bip S", "amazfit_bip_s"],
    ["Bip S Lite", "amazfit_bip_s_lite"],
    ["Amazfit Bip U", "amazfit_bip_u"],
    ["Amazfit Bip U Pro", "amazfit_bip_u_pro"],
    ["Amazfit Bip 3", "amazfit_bip_3"],
    ["Amazfit Bip 3 Pro", "amazfit_bip_3_pro"],
    ["Amazfit Cor", "amazfit_cor"],
    ["Amazfit Band", "amazfit_cor"],
    ["Amazfit Cor 2", "amazfit_cor_2"],
    ["Amazfit Band 2", "amazfit_cor_2"],
    ["Amazfit GTR", "amazfit_gtr"],
    ["Amazfit GTR L", "amazfit_gtr_lite"],
    ["Amazfit GTR 2", "amazfit_gtr_2"],
    ["Amazfit GTR 2e", "amazfit_gtr_2e"],
    ["Amazfit GTS", "amazfit_gts"],
    ["Amazfit GTS 2", "amazfit_gts_2"],
    ["Amazfit GTS 2e", "amazfit_gts_2e"],
    ["Amazfit GTS2 mini", "amazfit_gts_2_mini"],
    ["Amazfit Neo", "amazfit_neo"],
    ["Amazfit Pop", "amazfit_pop"],
    ["Amazfit Pop Pro", "amazfit_pop_pro"],
    ["Amazfit T-Rex", "amazfit_trex"],
    ["Amazfit T-Rex Pro", "amazfit_trex_pro"],
    ["Amazfit Verge L", "amazfit_verge_lite"],
    ["Amazfit X", "amazfit_x"],
    ["Zepp E", "zepp_e"],
    ["Amazfit Band 5", "amazfit_band_5"],
    ["MI Band 2", "xiaomi_mi_band_2"],
    ["Mi Band HRX", "xiaomi_mi_band_2_hrx"],
    ["Mi Band 2i", "xiaomi_mi_band_2_hrx"],
    ["Mi Band 3", "xiaomi_mi_band_3"],
    ["Xiaomi Band 3", "xiaomi_mi_band_3"],
    ["Mi Smart Band 4", "xiaomi_mi_band_4"],
    ["Mi Smart Band 5", "xiaomi_mi_band_5"],
    ["Mi Smart Band 6", "xiaomi_mi_band_6"],
  ];
  for (const [name, id] of cases)
    expect(matchHuamiLegacyDevice(name), name).toBe(getHuamiLegacyModel(id) ?? null);
});

test("full-string patterns do not let a shorter name claim a longer model", () => {
  expect(matchHuamiLegacyDevice("Amazfit Bip U")).toBe(getHuamiLegacyModel("amazfit_bip_u")!);
  expect(matchHuamiLegacyDevice("Amazfit Bip U Pro")).toBe(
    getHuamiLegacyModel("amazfit_bip_u_pro")!,
  );
  expect(matchHuamiLegacyDevice("Amazfit Bip 3")).toBe(getHuamiLegacyModel("amazfit_bip_3")!);
  expect(matchHuamiLegacyDevice("Amazfit Bip 3 Pro")).toBe(
    getHuamiLegacyModel("amazfit_bip_3_pro")!,
  );
  expect(matchHuamiLegacyDevice("Amazfit GTR")).toBe(getHuamiLegacyModel("amazfit_gtr")!);
  expect(matchHuamiLegacyDevice("Amazfit GTR 2")).toBe(getHuamiLegacyModel("amazfit_gtr_2")!);
  expect(matchHuamiLegacyDevice("Amazfit Cor")).toBe(getHuamiLegacyModel("amazfit_cor")!);
  expect(matchHuamiLegacyDevice("Amazfit Cor 2")).toBe(getHuamiLegacyModel("amazfit_cor_2")!);
  // Upstream's GTS 2 Mini pattern has no space between GTS and 2.
  expect(matchHuamiLegacyDevice("Amazfit GTS 2 Mini")).toBeNull();
});

test("matching is case-insensitive like upstream Pattern.CASE_INSENSITIVE", () => {
  expect(matchHuamiLegacyDevice("amazfit bip u")).toBe(getHuamiLegacyModel("amazfit_bip_u")!);
  expect(matchHuamiLegacyDevice("MI SMART BAND 4")).toBe(getHuamiLegacyModel("xiaomi_mi_band_4")!);
  expect(matchHuamiLegacyDevice("zepp e")).toBe(getHuamiLegacyModel("zepp_e")!);
});

test("unrelated names and empty input do not match", () => {
  expect(matchHuamiLegacyDevice("Amazfit Bip 5")).toBeNull();
  expect(matchHuamiLegacyDevice("Amazfit Bip U Pro Max")).toBeNull();
  expect(matchHuamiLegacyDevice("Polar H10 ABC123")).toBeNull();
  expect(matchHuamiLegacyDevice("")).toBeNull();
  expect(matchHuamiLegacyDevice(null)).toBeNull();
  expect(matchHuamiLegacyDevice(undefined)).toBeNull();
});

test("the auth flag matrix follows the upstream support-class hierarchy", () => {
  const matrix: readonly [HuamiLegacyModelId, number, number][] = [
    ["amazfit_bip", 0x08, 0x00],
    ["amazfit_cor", 0x08, 0x00],
    ["amazfit_cor_2", 0x08, 0x00],
    ["xiaomi_mi_band_2", 0x08, 0x00],
    ["xiaomi_mi_band_2_hrx", 0x08, 0x00],
    ["xiaomi_mi_band_3", 0x00, 0x00],
    ["amazfit_bip_lite", 0x00, 0x80],
    ["amazfit_bip_s", 0x00, 0x80],
    ["amazfit_bip_s_lite", 0x00, 0x80],
    ["amazfit_bip_u", 0x00, 0x80],
    ["amazfit_bip_u_pro", 0x00, 0x80],
    ["amazfit_gtr", 0x00, 0x80],
    ["amazfit_gts", 0x00, 0x80],
    ["amazfit_trex", 0x00, 0x80],
    ["xiaomi_mi_band_4", 0x00, 0x80],
    ["xiaomi_mi_band_5", 0x00, 0x80],
    ["zepp_e", 0x00, 0x80],
  ];
  for (const [id, authFlags, cryptFlags] of matrix) {
    const model = getHuamiLegacyModel(id)!;
    expect(model.authFlags, id).toBe(authFlags);
    expect(model.cryptFlags, id).toBe(cryptFlags);
  }
});

test("fixed sample sizes match the upstream support classes", () => {
  const four: readonly HuamiLegacyModelId[] = [
    "amazfit_bip",
    "amazfit_bip_lite",
    "amazfit_bip_s",
    "amazfit_bip_s_lite",
    "amazfit_cor",
    "amazfit_cor_2",
    "amazfit_verge_lite",
    "xiaomi_mi_band_2",
    "xiaomi_mi_band_2_hrx",
    "xiaomi_mi_band_3",
    "xiaomi_mi_band_4",
  ];
  const eight: readonly HuamiLegacyModelId[] = [
    "amazfit_bip_u",
    "amazfit_bip_u_pro",
    "amazfit_bip_3",
    "amazfit_bip_3_pro",
    "amazfit_gtr_2",
    "amazfit_gtr_2e",
    "amazfit_gts_2",
    "amazfit_gts_2e",
    "amazfit_gts_2_mini",
    "amazfit_neo",
    "amazfit_pop",
    "amazfit_pop_pro",
    "amazfit_x",
    "zepp_e",
    "amazfit_band_5",
    "xiaomi_mi_band_5",
    "xiaomi_mi_band_6",
  ];
  for (const id of four)
    expect(getHuamiLegacyModel(id)!.sampleSize, id).toEqual({ kind: "fixed", size: 4 });
  for (const id of eight)
    expect(getHuamiLegacyModel(id)!.sampleSize, id).toEqual({ kind: "fixed", size: 8 });
});

test("firmware-gated models follow the upstream version thresholds", () => {
  const gtr = getHuamiLegacyModel("amazfit_gtr")!.sampleSize;
  expect(resolveHuamiSampleSize(gtr, null)).toBe(4);
  expect(resolveHuamiSampleSize(gtr, "1.3.5.78")).toBe(4);
  expect(resolveHuamiSampleSize(gtr, "1.3.5.79")).toBe(8);
  // 32 mm variant with the alternate scheme.
  expect(resolveHuamiSampleSize(gtr, "0.1.1.15")).toBe(8);
  // 47 mm variant below the main gate stays at 4.
  expect(resolveHuamiSampleSize(gtr, "1.2.0.00")).toBe(4);

  const lite = getHuamiLegacyModel("amazfit_gtr_lite")!.sampleSize;
  expect(resolveHuamiSampleSize(lite, "1.0.0.32")).toBe(4);
  expect(resolveHuamiSampleSize(lite, "1.0.0.33")).toBe(8);

  const gts = getHuamiLegacyModel("amazfit_gts")!.sampleSize;
  expect(resolveHuamiSampleSize(gts, "0.0.9.00")).toBe(4);
  expect(resolveHuamiSampleSize(gts, "0.0.9.01")).toBe(8);

  const trex = getHuamiLegacyModel("amazfit_trex")!.sampleSize;
  expect(resolveHuamiSampleSize(trex, "0.0.9.01")).toBe(8);
  expect(getHuamiLegacyModel("amazfit_trex_pro")!.sampleSize).toEqual(trex);
});

test("version comparison is numeric, not lexical", () => {
  expect(compareHuamiFirmwareVersion("1.10.0.0", "1.9.9.9")).toBe(1);
  expect(compareHuamiFirmwareVersion("1.0.0.33", "1.0.0.33")).toBe(0);
  expect(compareHuamiFirmwareVersion("0.0.9.00", "0.0.9.1")).toBe(-1);
});
