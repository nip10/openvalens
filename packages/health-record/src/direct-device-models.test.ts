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
  expect(DIRECT_DEVICE_MODELS).toHaveLength(453);
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

test("Moyoung catalog resolves the 31 catalog models", () => {
  expect(DIRECT_DEVICE_MODELS.filter(({ family }) => family === "moyoung")).toHaveLength(31);
  expect(findDirectDeviceModel({ family: "moyoung", modelId: "moyoung_c20" })).toEqual({
    family: "moyoung",
    modelId: "moyoung_c20",
    displayName: "Moyoung C20",
  });
  expect(
    findDirectDeviceModel({ family: "moyoung", modelId: "moyoung_advan_watch_se1_ai" })
      ?.displayName,
  ).toBe("Moyoung Advan Watch SE1 AI");
  expect(
    findDirectDeviceModel({ family: "moyoung", modelId: "moyoung_colmi_i28_ultra" })?.displayName,
  ).toBe("Moyoung Colmi I28 Ultra");
  expect(
    findDirectDeviceModel({ family: "moyoung", modelId: "moyoung_fireboltt_ninja_phantom" })
      ?.displayName,
  ).toBe("Moyoung Fireboltt Ninja Phantom");
  expect(
    findDirectDeviceModel({ family: "moyoung", modelId: "moyoung_itech_active_3" })?.displayName,
  ).toBe("Moyoung iTech Active 3");
  expect(
    findDirectDeviceModel({ family: "moyoung", modelId: "moyoung_ksix_venture" })?.displayName,
  ).toBe("Moyoung KSIX Venture");
  expect(findDirectDeviceModel({ family: "moyoung", modelId: "moyoung_zl02d" })?.displayName).toBe(
    "Moyoung ZL02D",
  );
  expect(isDirectDeviceIdentity({ family: "moyoung", modelId: "moyoung_c20_pro" })).toBe(true);
  // Unknown models and cross-family model ids are rejected.
  expect(isDirectDeviceIdentity({ family: "moyoung", modelId: "moyoung_unknown" })).toBe(false);
  expect(isDirectDeviceIdentity({ family: "moyoung", modelId: "garmin_fenix_7" })).toBe(false);
  expect(isDirectDeviceIdentity({ family: "gloryfit", modelId: "moyoung_c20" })).toBe(false);
});

test("Garmin catalog resolves every upstream vendor model", () => {
  // 190 upstream `vendor: garmin` entries in the committed Gadgetbridge catalog.
  expect(DIRECT_DEVICE_MODELS.filter(({ family }) => family === "garmin")).toHaveLength(190);
  expect(findDirectDeviceModel({ family: "garmin", modelId: "garmin_fenix_7" })).toEqual({
    family: "garmin",
    modelId: "garmin_fenix_7",
    displayName: "Garmin Fenix 7",
  });
  expect(
    findDirectDeviceModel({ family: "garmin", modelId: "garmin_edge_1040" })?.displayName,
  ).toBe("Garmin Edge 1040");
  expect(
    findDirectDeviceModel({ family: "garmin", modelId: "garmin_edge_520_plus" })?.displayName,
  ).toBe("Garmin Edge 520 Plus");
  expect(
    findDirectDeviceModel({ family: "garmin", modelId: "garmin_edge_explore_2" })?.displayName,
  ).toBe("Garmin Edge Explore 2");
  expect(findDirectDeviceModel({ family: "garmin", modelId: "garmin_etrex_se" })?.displayName).toBe(
    "Garmin eTrex SE",
  );
  expect(
    findDirectDeviceModel({ family: "garmin", modelId: "garmin_gpsmap_66i" })?.displayName,
  ).toBe("Garmin GPSMAP 66i");
  expect(
    findDirectDeviceModel({ family: "garmin", modelId: "garmin_hrm_pro_plus" })?.displayName,
  ).toBe("Garmin HRM Pro Plus");
  expect(
    findDirectDeviceModel({ family: "garmin", modelId: "garmin_inreach_mini_2" })?.displayName,
  ).toBe("Garmin inReach Mini 2");
  expect(
    findDirectDeviceModel({ family: "garmin", modelId: "garmin_quatix_7x" })?.displayName,
  ).toBe("Garmin Quatix 7X");
  expect(isDirectDeviceIdentity({ family: "garmin", modelId: "garmin_hrm_600" })).toBe(true);
  // Unknown models and cross-family model ids are rejected.
  expect(isDirectDeviceIdentity({ family: "garmin", modelId: "garmin_unknown" })).toBe(false);
  expect(isDirectDeviceIdentity({ family: "garmin", modelId: "amazfit_bip" })).toBe(false);
  expect(isDirectDeviceIdentity({ family: "zepp_os", modelId: "garmin_fenix_7" })).toBe(false);
});

test("FitPro catalog resolves the 13 catalog models", () => {
  // 13 upstream `vendor: fitpro` entries in the committed Gadgetbridge catalog.
  expect(DIRECT_DEVICE_MODELS.filter(({ family }) => family === "fitpro")).toHaveLength(13);
  expect(findDirectDeviceModel({ family: "fitpro", modelId: "fitpro_m6" })).toEqual({
    family: "fitpro",
    modelId: "fitpro_m6",
    displayName: "FitPro M6",
  });
  expect(findDirectDeviceModel({ family: "fitpro", modelId: "colacao_2021" })?.displayName).toBe(
    "ColaCao 2021",
  );
  expect(findDirectDeviceModel({ family: "fitpro", modelId: "colacao_2023" })?.displayName).toBe(
    "ColaCao 2023",
  );
  expect(
    findDirectDeviceModel({ family: "fitpro", modelId: "fitpro_braz7harry" })?.displayName,
  ).toBe("FitPro BRAZ/7HARRY");
  expect(
    findDirectDeviceModel({ family: "fitpro", modelId: "fitpro_d13_116plus" })?.displayName,
  ).toBe("FitPro D13 116Plus");
  expect(findDirectDeviceModel({ family: "fitpro", modelId: "fitpro_fit_1900" })?.displayName).toBe(
    "FitPro Fit1900",
  );
  expect(findDirectDeviceModel({ family: "fitpro", modelId: "fitpro_lh716" })?.displayName).toBe(
    "FitPro LH716",
  );
  expect(findDirectDeviceModel({ family: "fitpro", modelId: "fitpro_m4" })?.displayName).toBe(
    "FitPro M4",
  );
  expect(
    findDirectDeviceModel({ family: "fitpro", modelId: "fitpro_series_11" })?.displayName,
  ).toBe("FitPro Series 11");
  expect(findDirectDeviceModel({ family: "fitpro", modelId: "fitpro_sunset_6" })?.displayName).toBe(
    "FitPro Sunset 6",
  );
  expect(findDirectDeviceModel({ family: "fitpro", modelId: "fitpro_watch_7" })?.displayName).toBe(
    "FitPro Watch 7",
  );
  expect(findDirectDeviceModel({ family: "fitpro", modelId: "fitpro_y68" })?.displayName).toBe(
    "FitPro Y68",
  );
  expect(findDirectDeviceModel({ family: "fitpro", modelId: "fitpro_ybw_05" })?.displayName).toBe(
    "FitPro YBW-05",
  );
  expect(isDirectDeviceIdentity({ family: "fitpro", modelId: "fitpro_ybw_05" })).toBe(true);
  // Unknown models and cross-family model ids are rejected.
  expect(isDirectDeviceIdentity({ family: "fitpro", modelId: "fitpro_unknown" })).toBe(false);
  expect(isDirectDeviceIdentity({ family: "fitpro", modelId: "garmin_fenix_7" })).toBe(false);
  expect(isDirectDeviceIdentity({ family: "gloryfit", modelId: "fitpro_m6" })).toBe(false);
});
