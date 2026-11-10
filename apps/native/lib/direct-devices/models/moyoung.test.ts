/**
 * Behavioural tests for the Moyoung / Da Fit registry.
 *
 * Derived from Gadgetbridge's Moyoung family at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import {
  MOYOUNG_DATA_IN_UUID,
  MOYOUNG_DATA_OUT_UUID,
  MOYOUNG_MODELS,
  MOYOUNG_SERVICE_UUID,
  getMoyoungModel,
  matchMoyoungDevice,
  type MoyoungModelId,
} from "./moyoung";

const EXPECTED_IDS: readonly MoyoungModelId[] = [
  "moyoung_blackview_r60",
  "moyoung_colmi_i28_ultra",
  "moyoung_colmi_p76",
  "moyoung_colmi_p80",
  "moyoung_colmi_p81",
  "moyoung_colmi_v72",
  "moyoung_colmi_v73",
  "moyoung_colmi_v76",
  "moyoung_colmi_v89",
  "moyoung_zl02d",
  "moyoung_advan_watch_se1_ai",
  "moyoung_alt_vibe",
  "moyoung_c20",
  "moyoung_c20_pro",
  "moyoung_hc96",
  "moyoung_itech_active_3",
  "moyoung_bettdow_fb051",
  "moyoung_fireboltt_069",
  "moyoung_fireboltt_ninja_phantom",
  "moyoung_fireboltt_talk",
  "moyoung_garett_eva",
  "moyoung_ksix_venture",
  "moyoung_kt80",
  "moyoung_kw19_b",
  "moyoung_l70",
  "moyoung_misirun_c17",
  "moyoung_mt55",
  "moyoung_p22b1",
  "moyoung_r50_pro",
  "moyoung_rainbuvvy_t97",
  "moyoung_viran_c29",
];

test("the registry contains the 31 Moyoung models exactly once", () => {
  expect(MOYOUNG_MODELS).toHaveLength(31);
  expect(new Set(MOYOUNG_MODELS.map((model) => model.id)).size).toBe(31);
  expect(MOYOUNG_MODELS.map((model) => model.id).sort()).toEqual([...EXPECTED_IDS].sort());
});

test("every model declares heart-rate and sleep records on the feea service", () => {
  for (const model of MOYOUNG_MODELS) {
    expect(model.transportValidated, model.id).toBe(false);
    expect(model.displayName.length, model.id).toBeGreaterThan(0);
    expect(model.records, model.id).toEqual(["heart_rate", "sleep_session"]);
    expect(model.serviceUuids, model.id).toEqual([MOYOUNG_SERVICE_UUID]);
    expect(model.sourceFiles.length, model.id).toBeGreaterThan(0);
    expect(model.sourceFiles.some((file) => file.includes("MoyoungConstants.java"))).toBe(true);
  }
});

test("getMoyoungModel resolves every registered id", () => {
  for (const model of MOYOUNG_MODELS) expect(getMoyoungModel(model.id)).toBe(model);
});

test("advertised names match the upstream full-string patterns", () => {
  const cases: readonly [string, MoyoungModelId][] = [
    ["R60", "moyoung_blackview_r60"],
    ["i28 Ultra", "moyoung_colmi_i28_ultra"],
    ["P76J", "moyoung_colmi_p76"],
    ["P80", "moyoung_colmi_p80"],
    ["P81c", "moyoung_colmi_p81"],
    ["V72", "moyoung_colmi_v72"],
    ["V73", "moyoung_colmi_v73"],
    ["V76", "moyoung_colmi_v76"],
    ["V89", "moyoung_colmi_v89"],
    ["V89.", "moyoung_colmi_v89"],
    ["ZL02D", "moyoung_zl02d"],
    ["SE1", "moyoung_advan_watch_se1_ai"],
    ["Alt Vibe", "moyoung_alt_vibe"],
    ["C20", "moyoung_c20"],
    ["C 20", "moyoung_c20"],
    ["C  20", "moyoung_c20"],
    ["C20_Pro", "moyoung_c20_pro"],
    ["HC96", "moyoung_hc96"],
    ["iTECH Active 3", "moyoung_itech_active_3"],
    ["Bettdow FB051", "moyoung_bettdow_fb051"],
    ["FireBoltt 069", "moyoung_fireboltt_069"],
    ["FB BGS001", "moyoung_fireboltt_ninja_phantom"],
    ["FireBoltt 080", "moyoung_fireboltt_talk"],
    ["Garett Eva", "moyoung_garett_eva"],
    ["KSIX VENTURE", "moyoung_ksix_venture"],
    ["KT80", "moyoung_kt80"],
    ["KW19-B", "moyoung_kw19_b"],
    ["L 70", "moyoung_l70"],
    ["L70", "moyoung_l70"],
    ["L   70", "moyoung_l70"],
    ["C17", "moyoung_misirun_c17"],
    ["MT55", "moyoung_mt55"],
    ["P22B1", "moyoung_p22b1"],
    ["R50Pro", "moyoung_r50_pro"],
    ["T97", "moyoung_rainbuvvy_t97"],
    ["C29", "moyoung_viran_c29"],
  ];
  for (const [name, id] of cases)
    expect(matchMoyoungDevice(name), name).toBe(getMoyoungModel(id) ?? null);
});

test("patterns are case-sensitive except P22B1, which upstream compiles case-insensitively", () => {
  expect(matchMoyoungDevice("i28 ultra")).toBeNull();
  expect(matchMoyoungDevice("p76j")).toBeNull();
  expect(matchMoyoungDevice("ksix venture")).toBeNull();
  expect(matchMoyoungDevice("kw19-b")).toBeNull();
  expect(matchMoyoungDevice("l70")).toBeNull();
  expect(matchMoyoungDevice("p22b1")).toBe(getMoyoungModel("moyoung_p22b1") ?? null);
  expect(matchMoyoungDevice("P22b1")).toBe(getMoyoungModel("moyoung_p22b1") ?? null);
});

test("near misses do not match", () => {
  for (const name of [
    "",
    "i28",
    "i28 Ultra Pro",
    "P76",
    "P76JX",
    "BGS001",
    "FB BGS001X",
    "KW19",
    "KW19-BC",
    "L7",
    "L 7",
    "V89x",
    "C2",
    "C20 Pro",
    "C20_Pro_2",
    "FireBoltt 0800",
    "R60 Pro",
    "P22B1X",
  ])
    expect(matchMoyoungDevice(name), name).toBeNull();
  expect(matchMoyoungDevice(null)).toBeNull();
  expect(matchMoyoungDevice(undefined)).toBeNull();
});

test("MTU is 508 except for the two models that inherit upstream's 20-byte default", () => {
  for (const model of MOYOUNG_MODELS) {
    if (model.id === "moyoung_kw19_b" || model.id === "moyoung_p22b1")
      expect(model.mtu, model.id).toBe(20);
    else expect(model.mtu, model.id).toBe(508);
  }
});

test("only L70 advertises heart-rate history (CMD 54)", () => {
  const withHistory = MOYOUNG_MODELS.filter((model) => model.supportsHeartRateHistory);
  expect(withHistory.map((model) => model.id)).toEqual(["moyoung_l70"]);
});

test("the feea service exposes distinct write and notify characteristics", () => {
  expect(MOYOUNG_SERVICE_UUID).toBe("0000feea-0000-1000-8000-00805f9b34fb");
  expect(MOYOUNG_DATA_OUT_UUID).toBe("0000fee2-0000-1000-8000-00805f9b34fb");
  expect(MOYOUNG_DATA_IN_UUID).toBe("0000fee3-0000-1000-8000-00805f9b34fb");
});
