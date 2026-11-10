/**
 * Behavioural tests for the Huawei/Honor health-wearable registry.
 *
 * Derived from Gadgetbridge's Huawei coordinators at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2 and the upstream
 * `device_support.yml` catalog snapshot. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import { getHuaweiModel, HUAWEI_MODELS, matchHuaweiDeviceName } from "./huawei";

test("the registry contains the 66 health-relevant Huawei/Honor wearables", () => {
  expect(HUAWEI_MODELS).toHaveLength(66);
  expect(new Set(HUAWEI_MODELS.map((model) => model.id)).size).toBe(66);
  expect(HUAWEI_MODELS.filter((model) => model.id.startsWith("honor_"))).toHaveLength(16);
  expect(HUAWEI_MODELS.filter((model) => model.id.startsWith("huawei_"))).toHaveLength(50);
  expect(new Set(HUAWEI_MODELS.map((model) => model.bleNamePrefix)).size).toBe(66);
});

test("every model is unvalidated and carries a coordinator prefix", () => {
  for (const model of HUAWEI_MODELS) {
    expect(model.displayName.length, model.id).toBeGreaterThan(0);
    expect(model.category, model.id).toBe("wearables");
    expect(["most", "unknown", "poor"], model.id).toContain(model.featureLevel);
    expect(model.transportValidated, model.id).toBe(false);
    expect(model.bleNamePrefix, model.id).toBe(model.bleNamePrefix.toLowerCase());
    expect(model.bleNamePrefix.endsWith("-"), model.id).toBe(true);
    expect(model.sourceFile, model.id).toContain("devices/huawei/");
    expect(model.sourceFile.endsWith("Coordinator.java"), model.id).toBe(true);
  }
});

test("upstream flags are preserved for representative models", () => {
  expect(getHuaweiModel("huawei_band_8")).toMatchObject({
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
  });
  expect(getHuaweiModel("huawei_watch_gt_2_pro")).toMatchObject({
    featureLevel: "poor",
    experimental: true,
  });
  expect(getHuaweiModel("honor_band_9")).toMatchObject({
    featureLevel: "unknown",
    experimental: true,
  });
});

test("matchHuaweiDeviceName is case-insensitive prefix matching", () => {
  expect(matchHuaweiDeviceName("Huawei Band 8-ABCD")?.id).toBe("huawei_band_8");
  expect(matchHuaweiDeviceName("huawei band 8-1234")?.id).toBe("huawei_band_8");
  expect(matchHuaweiDeviceName("HONOR BAND 9-ABCD")?.id).toBe("honor_band_9");
  expect(matchHuaweiDeviceName("Honor Watch 4 Pro-ABCD")?.id).toBe("honor_watch_4_pro");
  expect(matchHuaweiDeviceName("huawei b6-ABCD")?.id).toBe("huawei_talk_band_b6");
});

test("longer prefixes win over their generic parents", () => {
  expect(matchHuaweiDeviceName("huawei watch gt 2 pro-ABCD")?.id).toBe("huawei_watch_gt_2_pro");
  expect(matchHuaweiDeviceName("huawei watch gt 2-ABCD")?.id).toBe("huawei_watch_gt_2");
  expect(matchHuaweiDeviceName("huawei watch gt-ABCD")?.id).toBe("huawei_watch_gt");
  expect(matchHuaweiDeviceName("huawei watch fit 4 pro-ABCD")?.id).toBe("huawei_watch_fit_4_pro");
  expect(matchHuaweiDeviceName("huawei watch fit 4-ABCD")?.id).toBe("huawei_watch_fit_4");
  expect(matchHuaweiDeviceName("honor watch 4 pro-ABCD")?.id).toBe("honor_watch_4_pro");
  expect(matchHuaweiDeviceName("honor watch 4-ABCD")?.id).toBe("honor_watch_4");
});

test("matchHuaweiDeviceName handles the short-prefix coordinators", () => {
  expect(matchHuaweiDeviceName("watch gt runner 2-ABCD")?.id).toBe("huawei_watch_gt_runner_2");
  expect(matchHuaweiDeviceName("watch ultimate 2-ABCD")?.id).toBe("huawei_watch_ultimate_2");
  expect(matchHuaweiDeviceName("huawei band 3e-ABCD")?.id).toBe("huawei_band_3e");
  expect(matchHuaweiDeviceName("huawei band 4e-ABCD")?.id).toBe("huawei_band_4e");
});

test("matchHuaweiDeviceName rejects names without the coordinator hyphen", () => {
  expect(matchHuaweiDeviceName("")).toBeNull();
  expect(matchHuaweiDeviceName("Random Device")).toBeNull();
  expect(matchHuaweiDeviceName("huawei band 8")).toBeNull();
  expect(matchHuaweiDeviceName("huawei watch gt 2")).toBeNull();
  expect(matchHuaweiDeviceName("huawei band 99-ABCD")).toBeNull();
  expect(matchHuaweiDeviceName("honor watch 99-ABCD")).toBeNull();
});

test("exactly the 25 BLE-coordinator models carry the sync capability", () => {
  expect(HUAWEI_MODELS.filter((model) => model.sync)).toHaveLength(25);
  for (const id of [
    "honor_band_3",
    "honor_band_9",
    "honor_band_10",
    "honor_magic_watch",
    "huawei_band_2",
    "huawei_band_2_pro",
    "huawei_band_11_pro",
    "huawei_band_3e",
    "huawei_band_4e",
    "huawei_watch_fit",
    "huawei_watch_gt",
    "huawei_watch_gt_2e",
  ] as const) {
    expect(getHuaweiModel(id)?.sync, id).toBe(true);
  }
  for (const id of [
    "huawei_watch_gt_2",
    "huawei_watch_gt_4",
    "huawei_watch_fit_3",
    "huawei_watch_gt_5",
    "honor_watch_4",
    "huawei_watch_3",
    "huawei_talk_band_b6",
  ] as const) {
    expect(getHuaweiModel(id)?.sync, id).toBe(false);
  }
});

test("only the three new-Honor-protocol coordinators set the flag", () => {
  expect(HUAWEI_MODELS.filter((model) => model.newHonorProtocol).map((model) => model.id)).toEqual([
    "honor_band_7",
    "honor_band_9",
    "honor_band_10",
  ]);
  expect(getHuaweiModel("honor_band_6")?.newHonorProtocol).toBe(false);
});

test("every sync model is a BLE coordinator source file", () => {
  const bleSources = new Set([
    "honorband10/HonorBand10Coordinator.java",
    "honorband3/HonorBand3Coordinator.java",
    "honorband4/HonorBand4Coordinator.java",
    "honorband5/HonorBand5Coordinator.java",
    "honorband6/HonorBand6Coordinator.java",
    "honorband7/HonorBand7Coordinator.java",
    "honorband9/HonorBand9Coordinator.java",
    "honormagicwatch/HonorMagicWatchCoordinator.java",
    "huaweiband10/HuaweiBand10Coordinator.java",
    "huaweiband11/HuaweiBand11Coordinator.java",
    "huaweiband11pro/HuaweiBand11ProCoordinator.java",
    "huaweiband2pro/HuaweiBand2ProCoordinator.java",
    "huaweiband3pro/HuaweiBand3ProCoordinator.java",
    "huaweiband4pro/HuaweiBand4ProCoordinator.java",
    "huaweiband6/HuaweiBand6Coordinator.java",
    "huaweiband7/HuaweiBand7Coordinator.java",
    "huaweiband8/HuaweiBand8Coordinator.java",
    "huaweiband9/HuaweiBand9Coordinator.java",
    "huaweibandaw70/HuaweiBandAw70Coordinator.java",
    "huaweiwatchfit/HuaweiWatchFitCoordinator.java",
    "huaweiwatchgt/HuaweiWatchGTCoordinator.java",
    "huaweiwatchgt2e/HuaweiWatchGT2eCoordinator.java",
  ]);
  for (const model of HUAWEI_MODELS) {
    const file = model.sourceFile.split("devices/huawei/")[1]!;
    expect(model.sync, model.id).toBe(bleSources.has(file));
  }
});
