/**
 * Behavioural tests for the Garmin health-wearable registry.
 *
 * Derived from Gadgetbridge's Garmin coordinators at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2 and the upstream
 * `device_support.yml` catalog snapshot. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import { GARMIN_MODELS, getGarminModel, matchGarminDeviceName } from "./garmin";

test("the registry contains the 155 health-relevant Garmin wearables", () => {
  expect(GARMIN_MODELS).toHaveLength(155);
  expect(new Set(GARMIN_MODELS.map((model) => model.id)).size).toBe(155);
  expect(new Set(GARMIN_MODELS.map((model) => model.bleNamePattern)).size).toBe(155);
  expect(GARMIN_MODELS.filter((model) => model.featureLevel === "most")).toHaveLength(59);
  expect(GARMIN_MODELS.filter((model) => model.featureLevel === "partial")).toHaveLength(45);
  expect(GARMIN_MODELS.filter((model) => model.featureLevel === "unknown")).toHaveLength(51);
  expect(GARMIN_MODELS.filter((model) => model.experimental)).toHaveLength(57);
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
    enduro: 4,
    epix: 3,
    fenix: 37,
    forerunner: 37,
    instinct: 19,
    lily: 3,
    quatix: 3,
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
    expect(model.category, model.id).toBe("wearables");
    expect(["most", "partial", "unknown"], model.id).toContain(model.featureLevel);
    expect(model.transportValidated, model.id).toBe(false);
    expect(model.bleNamePattern.length, model.id).toBeGreaterThan(0);
    expect(model.sourceFile, model.id).toContain("devices/garmin/");
    expect(model.sourceFile.endsWith("Coordinator.java"), model.id).toBe(true);
  }
});

test("upstream flags are preserved for representative models", () => {
  expect(getGarminModel("garmin_fenix_7")).toMatchObject({
    displayName: "Garmin Fenix 7",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
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
});
