/**
 * Behavioural tests for the Garmin health-wearable registry.
 *
 * Derived from Gadgetbridge's Garmin coordinators at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2 and the upstream
 * `device_support.yml` catalog snapshot. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import { GARMIN_MODELS, getGarminMlrMode, getGarminModel, matchGarminDeviceName } from "./garmin";

test("the registry contains the 190 catalog Garmin entries", () => {
  expect(GARMIN_MODELS).toHaveLength(190);
  expect(new Set(GARMIN_MODELS.map((model) => model.id)).size).toBe(190);
  expect(new Set(GARMIN_MODELS.map((model) => model.bleNamePattern)).size).toBe(190);
  expect(GARMIN_MODELS.filter((model) => model.featureLevel === "most")).toHaveLength(59);
  expect(GARMIN_MODELS.filter((model) => model.featureLevel === "partial")).toHaveLength(62);
  expect(GARMIN_MODELS.filter((model) => model.featureLevel === "unknown")).toHaveLength(69);
  expect(GARMIN_MODELS.filter((model) => model.experimental)).toHaveLength(75);
});

test("the registry covers every catalog product line", () => {
  const counts = new Map<string, number>();
  for (const model of GARMIN_MODELS) {
    const family = model.id.slice("garmin_".length).split("_")[0]!;
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  expect(Object.fromEntries(counts)).toEqual({
    cirqa: 1,
    d2: 7,
    descent: 4,
    edge: 24,
    enduro: 4,
    epix: 3,
    etrex: 1,
    fenix: 37,
    forerunner: 37,
    gpsmap: 4,
    hrm: 3,
    inreach: 1,
    instinct: 19,
    lily: 3,
    quatix: 5,
    swim: 1,
    tactix: 3,
    venu: 12,
    vivoactive: 9,
    vivomove: 5,
    vivosmart: 6,
    vivosport: 1,
  });
});

test("every model is unvalidated and carries a coordinator pattern", () => {
  for (const model of GARMIN_MODELS) {
    expect(model.displayName.length, model.id).toBeGreaterThan(0);
    expect(["wearables", "bike-computers", "navigations", "hr-bands"], model.id).toContain(
      model.category,
    );
    expect(["most", "partial", "unknown"], model.id).toContain(model.featureLevel);
    expect(model.transportValidated, model.id).toBe(false);
    expect(model.bleNamePattern.length, model.id).toBeGreaterThan(0);
    expect(model.sourceFile, model.id).toContain("devices/garmin/");
    expect(
      model.sourceFile.endsWith("Coordinator.java") ||
        model.sourceFile.endsWith("Coordinator.kt") ||
        model.sourceFile.endsWith("GarminInReachMini2.java") ||
        model.sourceFile.endsWith("GarminProductNumbers.java"),
      model.id,
    ).toBe(true);
  }
});

test("only health wearables are marked for FIT data sync", () => {
  expect(GARMIN_MODELS.filter((model) => model.sync)).toHaveLength(157);
  for (const model of GARMIN_MODELS) {
    expect(model.sync, model.id).toBe(model.category === "wearables");
  }
  expect(getGarminModel("garmin_fenix_7")?.sync).toBe(true);
  expect(getGarminModel("garmin_edge_530")?.sync).toBe(false);
  expect(getGarminModel("garmin_gpsmap_66s")?.sync).toBe(false);
  expect(getGarminModel("garmin_hrm_200")?.sync).toBe(false);
});

test("upstream flags are preserved for representative models", () => {
  expect(getGarminModel("garmin_fenix_7")).toMatchObject({
    displayName: "Garmin Fenix 7",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
  });
  expect(getGarminModel("garmin_cirqa")).toMatchObject({
    displayName: "Garmin CIRQA",
    featureLevel: "partial",
    experimental: true,
  });
  expect(getGarminModel("garmin_fenix_9_pro_solar")).toMatchObject({
    featureLevel: "unknown",
    experimental: true,
  });
  expect(getGarminModel("garmin_edge_1040")).toMatchObject({
    displayName: "Garmin Edge 1040",
    category: "bike-computers",
    featureLevel: "partial",
    experimental: false,
    sync: false,
  });
  expect(getGarminModel("garmin_gpsmap_66i")).toMatchObject({
    category: "navigations",
    featureLevel: "unknown",
    experimental: true,
  });
  expect(getGarminModel("garmin_hrm_pro_plus")).toMatchObject({
    category: "hr-bands",
    featureLevel: "partial",
  });
  expect(getGarminModel("garmin_quatix_7")?.sourceFile).toEndWith("GarminProductNumbers.java");
});

test("matchGarminDeviceName uses the upstream full-string name fallback", () => {
  expect(matchGarminDeviceName("Forerunner 965")?.id).toBe("garmin_forerunner_965");
  expect(matchGarminDeviceName("UAT-4315")?.id).toBe("garmin_forerunner_965");
  expect(matchGarminDeviceName("fenix 7")?.id).toBe("garmin_fenix_7");
  expect(matchGarminDeviceName("Venu 3S")?.id).toBe("garmin_venu_3s");
  expect(matchGarminDeviceName("UAT-4261")?.id).toBe("garmin_venu_3s");
  expect(matchGarminDeviceName("Forerunner 570")?.id).toBe("garmin_forerunner_570");
  expect(matchGarminDeviceName("Forerunner 265s")?.id).toBe("garmin_forerunner_265s");
  expect(matchGarminDeviceName("Garmin Forerunner 265S")?.id).toBe("garmin_forerunner_265s");
});

test("matchGarminDeviceName covers the bike computers, navigators and straps", () => {
  expect(matchGarminDeviceName("Edge 2x")?.id).toBe("garmin_edge_25");
  expect(matchGarminDeviceName("Edge 530")?.id).toBe("garmin_edge_530");
  expect(matchGarminDeviceName("Edge 1030 Plus")?.id).toBe("garmin_edge_1030_plus");
  expect(matchGarminDeviceName("Edge Explore 2")?.id).toBe("garmin_edge_explore_2");
  expect(matchGarminDeviceName("eTrex SE")?.id).toBe("garmin_etrex_se");
  expect(matchGarminDeviceName("GPSMAP 66S #12")?.id).toBe("garmin_gpsmap_66s");
  expect(matchGarminDeviceName("GPSMAP 66SR")?.id).toBe("garmin_gpsmap_66sr");
  expect(matchGarminDeviceName("GPSMAP 66I #7")?.id).toBe("garmin_gpsmap_66i");
  expect(matchGarminDeviceName("GPSMAP H1")?.id).toBe("garmin_gpsmap_h1");
  expect(matchGarminDeviceName("HRM 200")?.id).toBe("garmin_hrm_200");
  expect(matchGarminDeviceName("HRM600:42")?.id).toBe("garmin_hrm_600");
  expect(matchGarminDeviceName("HRMPro+:123")?.id).toBe("garmin_hrm_pro_plus");
  expect(matchGarminDeviceName("inReach Mini 2")?.id).toBe("garmin_inreach_mini_2");
  expect(matchGarminDeviceName("quatix 7")?.id).toBe("garmin_quatix_7");
  expect(matchGarminDeviceName("quatix 7X")?.id).toBe("garmin_quatix_7x");
});

test("matchGarminDeviceName handles the accented vívo* names", () => {
  expect(matchGarminDeviceName("vívoactive HR")?.id).toBe("garmin_vivoactive_hr");
  expect(matchGarminDeviceName("vívosmart HR+")?.id).toBe("garmin_vivosmart_hr_plus");
  expect(matchGarminDeviceName("vívomove Trend")?.id).toBe("garmin_vivomove_trend");
  expect(matchGarminDeviceName("vívosport")?.id).toBe("garmin_vivosport");
});

test("matchGarminDeviceName accepts the optional size suffixes", () => {
  expect(matchGarminDeviceName("tactix 8 - 51mm")?.id).toBe("garmin_tactix_8");
  expect(matchGarminDeviceName("fenix 8 - 47mm")?.id).toBe("garmin_fenix_8");
  expect(matchGarminDeviceName("Instinct 3 - 45mm")?.id).toBe("garmin_instinct_3");
  expect(matchGarminDeviceName("Instinct 3 - 45mm Tac")?.id).toBe("garmin_instinct_3_tactical");
  expect(matchGarminDeviceName("Descent Mk3 43mm")?.id).toBe("garmin_descent_mk3");
});

test("matchGarminDeviceName rejects partial and differently-cased names", () => {
  expect(matchGarminDeviceName("")).toBeNull();
  expect(matchGarminDeviceName("Random Device")).toBeNull();
  expect(matchGarminDeviceName("Forerunner 965 UAT-4315")).toBeNull();
  expect(matchGarminDeviceName("Garmin Fenix 7")).toBeNull();
  expect(matchGarminDeviceName("Fenix 7")).toBeNull();
  expect(matchGarminDeviceName("Forerunner 570 Music")).toBeNull();
  expect(matchGarminDeviceName("Venu 3S UAT-4261")).toBeNull();
  expect(matchGarminDeviceName("vívoactive 99")).toBeNull();
  expect(matchGarminDeviceName("Edge 530 Mountain")).toBeNull();
  expect(matchGarminDeviceName("HRM 200 Pro")).toBeNull();
});

test("MLR is preferred exactly for the five upstream new-sync models", () => {
  // The coordinators that override `defaultNewSyncProtocol()` (and so force
  // MLR on, `GarminCoordinator.java:122-131`).
  const preferred = GARMIN_MODELS.filter((model) => getGarminMlrMode(model.id) === "preferred");
  expect(preferred.map((model) => model.id).sort()).toEqual([
    "garmin_cirqa",
    "garmin_d2_air_x15",
    "garmin_venu_4",
    "garmin_venu_x1",
    "garmin_vivoactive_6",
  ]);
  for (const model of preferred) expect(model.sync, model.id).toBe(true);
  expect(getGarminMlrMode("garmin_fenix_7")).toBe("off");
  expect(GARMIN_MODELS.every((model) => model.mlr === undefined || model.mlr === "preferred")).toBe(
    true,
  );
});
