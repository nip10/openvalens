import { expect, test } from "bun:test";

import {
  DIRECT_DEVICE_MODELS,
  findDirectDeviceModel,
  isDirectDeviceIdentity,
  supportsDirectDeviceSteps,
} from "./direct-device-models";

test("direct-device catalog has unique family/model pairs and supported steps identity", () => {
  const keys = DIRECT_DEVICE_MODELS.map(({ family, modelId }) => `${family}:${modelId}`);
  expect(new Set(keys).size).toBe(keys.length);
  expect(DIRECT_DEVICE_MODELS).toHaveLength(374);
  expect(
    findDirectDeviceModel({ family: "zepp_os", modelId: "amazfit_helio_strap" })?.displayName,
  ).toBe("Amazfit Helio Strap");
  expect(findDirectDeviceModel({ family: "ble_gatt", modelId: "polar_h10" })?.displayName).toBe(
    "Polar H10",
  );
  expect(
    findDirectDeviceModel({ family: "ble_gatt", modelId: "generic_health_thermometer" })
      ?.displayName,
  ).toBe("Generic Health Thermometer");
  expect(
    findDirectDeviceModel({ family: "ble_scale", modelId: "xiaomi_body_composition_scale_2" })
      ?.displayName,
  ).toBe("Xiaomi Body Composition Scale 2");
  expect(findDirectDeviceModel({ family: "ble_scale", modelId: "viatom_f8" })?.displayName).toBe(
    "Viatom F8",
  );
  expect(findDirectDeviceModel({ family: "colmi_ring", modelId: "colmi_r02" })?.displayName).toBe(
    "Colmi R02",
  );
  expect(
    findDirectDeviceModel({ family: "colmi_ring", modelId: "yawell_ai_health_watchpad" })
      ?.displayName,
  ).toBe("Yawell Y27 AI Health WatchPad");
  expect(findDirectDeviceModel({ family: "ble_gatt", modelId: "pinetime_p8" })?.displayName).toBe(
    "PineTime (InfiniTime)",
  );
  expect(findDirectDeviceModel({ family: "bangle_js", modelId: "bangle_js_1" })?.displayName).toBe(
    "Bangle.js 1",
  );
  expect(findDirectDeviceModel({ family: "bangle_js", modelId: "bangle_js_2" })?.displayName).toBe(
    "Bangle.js 2",
  );
  expect(isDirectDeviceIdentity({ family: "bangle_js", modelId: "bangle_js_2" })).toBe(true);
  expect(isDirectDeviceIdentity({ family: "ble_gatt", modelId: "pinetime_p8" })).toBe(true);
  expect(isDirectDeviceIdentity({ family: "bangle_js", modelId: "bangle_js_3" })).toBe(false);
  expect(findDirectDeviceModel({ family: "gloryfit", modelId: "gloryfit_d3" })?.displayName).toBe(
    "GloryFit D3",
  );
  expect(
    findDirectDeviceModel({ family: "gloryfit", modelId: "haylou_watch_2_pro" })?.displayName,
  ).toBe("Haylou Watch 2 Pro");
  expect(findDirectDeviceModel({ family: "gloryfit", modelId: "imiki_frame_2" })?.displayName).toBe(
    "IMIKI Frame 2",
  );
  expect(
    findDirectDeviceModel({ family: "gloryfit", modelId: "kieslect_calling_smartwatch_kr_pro" })
      ?.displayName,
  ).toBe("Kieslect Kr Pro");
  expect(DIRECT_DEVICE_MODELS.filter(({ family }) => family === "gloryfit")).toHaveLength(17);
  expect(isDirectDeviceIdentity({ family: "gloryfit", modelId: "qecnato_s10" })).toBe(true);
  expect(isDirectDeviceIdentity({ family: "gloryfit", modelId: "gloryfit_d3" })).toBe(true);
  expect(isDirectDeviceIdentity({ family: "gloryfit", modelId: "gloryfit_unknown" })).toBe(false);
  expect(supportsDirectDeviceSteps({ family: "zepp_os", modelId: "amazfit_helio_strap" })).toBe(
    true,
  );
  expect(supportsDirectDeviceSteps({ family: "ble_gatt", modelId: "polar_h10" })).toBe(false);
  expect(supportsDirectDeviceSteps({ family: "garmin", modelId: "garmin_fenix_7" })).toBe(false);
  expect(isDirectDeviceIdentity({ family: "xiaomi", modelId: "xiaomi_mi_band_10" })).toBe(true);
  expect(isDirectDeviceIdentity({ family: "xiaomi", modelId: "garmin_fenix_7" })).toBe(false);
});

test("legacy Huami catalog resolves Amazfit and Mi Band models", () => {
  expect(DIRECT_DEVICE_MODELS.filter(({ family }) => family === "huami_legacy")).toHaveLength(33);
  expect(findDirectDeviceModel({ family: "huami_legacy", modelId: "amazfit_bip" })).toEqual({
    family: "huami_legacy",
    modelId: "amazfit_bip",
    displayName: "Amazfit Bip",
  });
  expect(
    findDirectDeviceModel({ family: "huami_legacy", modelId: "amazfit_gts_2_mini" })?.displayName,
  ).toBe("Amazfit GTS 2 Mini");
  expect(
    findDirectDeviceModel({ family: "huami_legacy", modelId: "amazfit_trex_pro" })?.displayName,
  ).toBe("Amazfit T-Rex Pro");
  expect(findDirectDeviceModel({ family: "huami_legacy", modelId: "zepp_e" })?.displayName).toBe(
    "Zepp E",
  );
  expect(
    findDirectDeviceModel({ family: "huami_legacy", modelId: "amazfit_band_5" })?.displayName,
  ).toBe("Amazfit Band 5");
  expect(
    findDirectDeviceModel({ family: "huami_legacy", modelId: "xiaomi_mi_band_2_hrx" })?.displayName,
  ).toBe("Mi Band 2 HRX");
  expect(
    findDirectDeviceModel({ family: "huami_legacy", modelId: "xiaomi_mi_band_4" })?.displayName,
  ).toBe("Mi Smart Band 4");
  expect(
    findDirectDeviceModel({ family: "huami_legacy", modelId: "xiaomi_mi_band_6" })?.displayName,
  ).toBe("Mi Smart Band 6");
  expect(isDirectDeviceIdentity({ family: "huami_legacy", modelId: "amazfit_bip_s" })).toBe(true);
  expect(isDirectDeviceIdentity({ family: "huami_legacy", modelId: "xiaomi_mi_band_5" })).toBe(
    true,
  );
  // Unknown models and cross-family model ids are rejected.
  expect(isDirectDeviceIdentity({ family: "huami_legacy", modelId: "amazfit_unknown" })).toBe(
    false,
  );
  expect(isDirectDeviceIdentity({ family: "huami_legacy", modelId: "garmin_fenix_7" })).toBe(false);
  expect(isDirectDeviceIdentity({ family: "zepp_os", modelId: "amazfit_bip" })).toBe(false);
  expect(isDirectDeviceIdentity({ family: "huami_legacy", modelId: "xiaomi_mi_band_10" })).toBe(
    false,
  );
});
