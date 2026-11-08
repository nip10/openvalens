/**
 * Behavioural tests for the Xiaomi protobuf device-model registry.
 *
 * Derived from Gadgetbridge's Xiaomi coordinators at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2 and the upstream
 * `device_support.yml` catalog snapshot. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import { getXiaomiModel, matchXiaomiDeviceName, XIAOMI_MODELS, type XiaomiModelId } from "./xiaomi";

const EXPECTED_IDS: readonly XiaomiModelId[] = [
  "xiaomi_mi_band_10",
  "xiaomi_mi_band_10_pro",
  "xiaomi_mi_band_11",
  "xiaomi_mi_band_11_active",
  "xiaomi_mi_band_4c",
  "xiaomi_mi_band_7_pro",
  "xiaomi_mi_band_8",
  "xiaomi_mi_band_8_active",
  "xiaomi_mi_band_8_pro",
  "xiaomi_mi_band_9",
  "xiaomi_mi_band_9_active",
  "xiaomi_mi_band_9_pro",
  "xiaomi_mi_watch_color_sport",
  "xiaomi_mi_watch_lite",
  "xiaomi_redmi_smart_band_2",
  "xiaomi_redmi_smart_band_3",
  "xiaomi_redmi_smart_band_pro",
  "xiaomi_redmi_watch_2",
  "xiaomi_redmi_watch_2_lite",
  "xiaomi_redmi_watch_3",
  "xiaomi_redmi_watch_3_active",
  "xiaomi_redmi_watch_4",
  "xiaomi_redmi_watch_5",
  "xiaomi_redmi_watch_5_active",
  "xiaomi_redmi_watch_5_lite",
  "xiaomi_redmi_watch_6",
  "xiaomi_redmi_watch_move",
  "xiaomi_watch_5",
  "xiaomi_watch_s1",
  "xiaomi_watch_s1_active",
  "xiaomi_watch_s1_pro",
  "xiaomi_watch_s3",
  "xiaomi_watch_s4",
  "xiaomi_watch_s5",
];

test("the registry contains all 34 os_xiaomi_protobuf models exactly once", () => {
  expect(XIAOMI_MODELS).toHaveLength(34);
  expect(new Set(XIAOMI_MODELS.map((model) => model.id)).size).toBe(34);
  expect(XIAOMI_MODELS.map((model) => model.id).sort()).toEqual([...EXPECTED_IDS].sort());
});

test("every model is unvalidated and carries a coordinator pattern", () => {
  for (const model of XIAOMI_MODELS) {
    expect(model.displayName.length, model.id).toBeGreaterThan(0);
    expect(model.category, model.id).toBe("wearables");
    expect(["high", "most", "partial", "unknown"], model.id).toContain(model.featureLevel);
    expect(model.transportValidated, model.id).toBe(false);
    expect(model.bleNamePattern.startsWith("^"), model.id).toBe(true);
    expect(model.bleNamePattern.endsWith("$"), model.id).toBe(true);
    expect(model.sourceFile, model.id).toContain("devices/xiaomi/watches/");
    expect(() => new RegExp(model.bleNamePattern), model.id).not.toThrow();
  }
});

test("upstream flags are preserved", () => {
  expect(getXiaomiModel("xiaomi_mi_band_8")).toMatchObject({
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
  });
  expect(getXiaomiModel("xiaomi_mi_band_4c")).toMatchObject({
    featureLevel: "partial",
    experimental: true,
  });
  expect(getXiaomiModel("xiaomi_watch_s4")).toMatchObject({
    featureLevel: "most",
    experimental: false,
  });
});

test("matchXiaomiDeviceName accepts the coordinator patterns", () => {
  expect(matchXiaomiDeviceName("Xiaomi Smart Band 8 ABCD")?.id).toBe("xiaomi_mi_band_8");
  expect(matchXiaomiDeviceName("Xiaomi Smart Band 10 1A2B")?.id).toBe("xiaomi_mi_band_10");
  expect(matchXiaomiDeviceName("Xiaomi Smart Band 11 Active 0F1E")?.id).toBe(
    "xiaomi_mi_band_11_active",
  );
  expect(matchXiaomiDeviceName("Xiaomi Band 11 Active 0F1E")?.id).toBe("xiaomi_mi_band_11_active");
  expect(matchXiaomiDeviceName("Mi Smart Band 4C_ABCD")?.id).toBe("xiaomi_mi_band_4c");
  expect(matchXiaomiDeviceName("Mi ColorS 9ABC")?.id).toBe("xiaomi_mi_watch_color_sport");
  expect(matchXiaomiDeviceName("Mi Watch Lite_ABCD")?.id).toBe("xiaomi_mi_watch_lite");
  expect(matchXiaomiDeviceName("Redmi Watch 6 NFC 12AB")?.id).toBe("xiaomi_redmi_watch_6");
  expect(matchXiaomiDeviceName("Redmi Watch 6 12AB")?.id).toBe("xiaomi_redmi_watch_6");
});

test("matchXiaomiDeviceName handles the unusual coordinator patterns", () => {
  expect(matchXiaomiDeviceName("Move")?.id).toBe("xiaomi_redmi_watch_move");
  expect(matchXiaomiDeviceName("Move ABCD")).toBeNull();

  expect(matchXiaomiDeviceName("Xiaomi Watch 5 ABCD")?.id).toBe("xiaomi_watch_5");
  expect(matchXiaomiDeviceName("Xiaomi Watch 5 Pro ABCD")).toBeNull();
  expect(matchXiaomiDeviceName("Xiaomi Watch 5 Lite ABCD")).toBeNull();

  expect(matchXiaomiDeviceName("Xiaomi Watch S1 Pro ABCD")?.id).toBe("xiaomi_watch_s1_pro");
  expect(matchXiaomiDeviceName("L61ABC ABCD")?.id).toBe("xiaomi_watch_s1_pro");
  expect(matchXiaomiDeviceName("Xiaomi Watch S3 eSIM ABCD")?.id).toBe("xiaomi_watch_s3");
  expect(matchXiaomiDeviceName("Xiaomi Watch S5 46mm ABCD")?.id).toBe("xiaomi_watch_s5");
  expect(matchXiaomiDeviceName("Xiaomi Smart Band 7 Pro anything")?.id).toBe(
    "xiaomi_mi_band_7_pro",
  );
});

test("matchXiaomiDeviceName rejects names without the required suffix", () => {
  expect(matchXiaomiDeviceName("")).toBeNull();
  expect(matchXiaomiDeviceName("Random Device")).toBeNull();
  expect(matchXiaomiDeviceName("Xiaomi Smart Band 8")).toBeNull();
  expect(matchXiaomiDeviceName("Xiaomi Smart Band 8 abcd")).toBeNull();
  expect(matchXiaomiDeviceName("Xiaomi Smart Band 8 ABCD EXTRA")).toBeNull();
  expect(matchXiaomiDeviceName("Xiaomi Watch S1 Active")).toBeNull();
});
