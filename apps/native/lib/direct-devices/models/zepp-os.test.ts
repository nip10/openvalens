/**
 * Behavioural tests for the Zepp OS device-model registry.
 *
 * The registry is derived from Gadgetbridge's Zepp OS coordinators at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2 and the upstream `device_support.yml`
 * catalog snapshot. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import { getZeppOsModel, matchDeviceName, ZEPP_OS_MODELS, type ZeppOsModelId } from "./zepp-os";

const EXPECTED_IDS: readonly ZeppOsModelId[] = [
  "amazfit_active",
  "amazfit_active_2",
  "amazfit_active_3_premium",
  "amazfit_active_edge",
  "amazfit_active_max",
  "amazfit_balance",
  "amazfit_balance_2",
  "amazfit_balance_2_xt",
  "amazfit_balance_3",
  "amazfit_balance_ultra",
  "amazfit_band_7",
  "amazfit_bip_5",
  "amazfit_bip_5_unity",
  "amazfit_bip_6",
  "amazfit_bip_max",
  "amazfit_cheetah",
  "amazfit_cheetah_2_pro",
  "amazfit_cheetah_2_ultra",
  "amazfit_cheetah_pro",
  "amazfit_falcon",
  "amazfit_gtr_3",
  "amazfit_gtr_3_pro",
  "amazfit_gtr_4",
  "amazfit_gtr_mini",
  "amazfit_gts_3",
  "amazfit_gts_4",
  "amazfit_gts_4_mini",
  "amazfit_gts_4_mini_new",
  "amazfit_helio_ring",
  "amazfit_helio_strap",
  "amazfit_trex_2",
  "amazfit_trex_3",
  "amazfit_trex_3_pro",
  "amazfit_trex_ultra",
  "amazfit_trex_ultra_2",
  "xiaomi_mi_band_7",
];

test("the registry contains all 36 os_zepp models exactly once", () => {
  expect(ZEPP_OS_MODELS).toHaveLength(36);
  expect(new Set(ZEPP_OS_MODELS.map((model) => model.id)).size).toBe(36);
  expect(ZEPP_OS_MODELS.map((model) => model.id).sort()).toEqual([...EXPECTED_IDS].sort());
});

test("every model carries names, flags and a coordinator source file", () => {
  for (const model of ZEPP_OS_MODELS) {
    expect(model.displayName.length, model.id).toBeGreaterThan(0);
    expect(["rings", "wearables"], model.id).toContain(model.category);
    expect(["high", "most", "unknown"], model.id).toContain(model.featureLevel);
    expect(typeof model.experimental, model.id).toBe("boolean");
    expect(typeof model.transportValidated, model.id).toBe("boolean");
    expect(model.bleNames.length, model.id).toBeGreaterThan(0);
    expect(model.sourceFiles.length, model.id).toBeGreaterThan(0);
    for (const name of model.bleNames) {
      expect(name.length, model.id).toBeGreaterThan(0);
    }
    for (const file of model.sourceFiles) {
      expect(file, model.id).toContain("devices/huami/zeppos/");
      expect(file.endsWith(".java"), model.id).toBe(true);
    }
  }
});

test("exactly one model is transport-validated: the Helio Strap", () => {
  const validated = ZEPP_OS_MODELS.filter((model) => model.transportValidated);

  expect(validated).toHaveLength(1);
  expect(validated[0]!.id).toBe("amazfit_helio_strap");
});

test("BLE names are unique across models", () => {
  const names = ZEPP_OS_MODELS.flatMap((model) => model.bleNames);
  expect(new Set(names).size).toBe(names.length);
});

test("upstream flags and categories are preserved", () => {
  const helioStrap = getZeppOsModel("amazfit_helio_strap")!;
  expect(helioStrap).toMatchObject({
    category: "wearables",
    featureLevel: "most",
    experimental: true,
    transportValidated: true,
  });

  const helioRing = getZeppOsModel("amazfit_helio_ring")!;
  expect(helioRing).toMatchObject({
    category: "rings",
    featureLevel: "most",
    experimental: true,
    transportValidated: false,
  });

  const activeEdge = getZeppOsModel("amazfit_active_edge")!;
  expect(activeEdge).toMatchObject({ featureLevel: "unknown", experimental: true });
});

test("matchDeviceName accepts exact coordinator names", () => {
  expect(matchDeviceName("Amazfit Helio Strap")?.id).toBe("amazfit_helio_strap");
  expect(matchDeviceName("Amazfit GTR 4")?.id).toBe("amazfit_gtr_4");
  expect(matchDeviceName("Xiaomi Smart Band 7")?.id).toBe("xiaomi_mi_band_7");
  expect(matchDeviceName("Amazfit BIP Max")?.id).toBe("amazfit_bip_max");
  expect(matchDeviceName("Amazfit GTS 4 mini New")?.id).toBe("amazfit_gts_4_mini_new");
});

test("matchDeviceName accepts names shared by several coordinators", () => {
  expect(matchDeviceName("Active 2 (Round)")?.id).toBe("amazfit_active_2");
  expect(matchDeviceName("Active 2 NFC (Square)")?.id).toBe("amazfit_active_2");
  expect(matchDeviceName("Amazfit Cheetah R")?.id).toBe("amazfit_cheetah");
  expect(matchDeviceName("Amazfit Cheetah S")?.id).toBe("amazfit_cheetah");
  expect(matchDeviceName("T-Rex 3 Pro (44mm)")?.id).toBe("amazfit_trex_3_pro");
  expect(matchDeviceName("T-Rex 3 Pro (48mm)")?.id).toBe("amazfit_trex_3_pro");
  expect(matchDeviceName("Amazfit GTR 4 LE")?.id).toBe("amazfit_gtr_4");
});

test("matchDeviceName accepts the optional four-character MAC suffix", () => {
  expect(matchDeviceName("Amazfit GTR 4 AB12")?.id).toBe("amazfit_gtr_4");
  expect(matchDeviceName("Amazfit GTR 4-AB12")?.id).toBe("amazfit_gtr_4");
  expect(matchDeviceName("Amazfit GTR 4  AB12")?.id).toBe("amazfit_gtr_4");
  expect(matchDeviceName("Amazfit GTR 4 LE AB12")?.id).toBe("amazfit_gtr_4");
  expect(matchDeviceName("Amazfit Helio Strap AB12")?.id).toBe("amazfit_helio_strap");
});

test("matchDeviceName rejects malformed suffixes", () => {
  expect(matchDeviceName("Amazfit GTR 4 AB1")).toBeNull();
  expect(matchDeviceName("Amazfit GTR 4 AB123")).toBeNull();
  expect(matchDeviceName("Amazfit GTR 4 ab12")).toBeNull();
  expect(matchDeviceName("Amazfit GTR 4 AB-12")).toBeNull();
  expect(matchDeviceName("Amazfit GTR 4 AB12 ")).toBeNull();
  expect(matchDeviceName("Amazfit Helio Strap 2")).toBeNull();
});

test("matchDeviceName rejects non-model names and is case-sensitive", () => {
  expect(matchDeviceName("")).toBeNull();
  expect(matchDeviceName("Random Device")).toBeNull();
  expect(matchDeviceName("Amazfit GTR")).toBeNull();
  expect(matchDeviceName("Amazfit Helio")).toBeNull();
  expect(matchDeviceName("amazfit helio strap")).toBeNull();
  expect(matchDeviceName("Amazfit Active 2")).toBeNull();
});

test("matchDeviceName does not confuse a prefix with a suffix", () => {
  expect(matchDeviceName("Amazfit Active")?.id).toBe("amazfit_active");
  expect(matchDeviceName("Amazfit Active Edge")?.id).toBe("amazfit_active_edge");
  expect(matchDeviceName("Amazfit Active AB12")?.id).toBe("amazfit_active");
  expect(matchDeviceName("Amazfit Active Edge AB12")?.id).toBe("amazfit_active_edge");
});
