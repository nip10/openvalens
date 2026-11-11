/**
 * Tests for the per-model support status used by the settings screen.
 *
 * The status must stay honest: upstream catalog facts are attributed to
 * Gadgetbridge, and OpenValens status never claims more than the family
 * actually implements.
 */

import { expect, test } from "bun:test";

import { getGarminModel } from "./models/garmin";
import { getHuaweiModel } from "./models/huawei";
import { getBleScaleModel } from "./models/ble-scale";
import { getColmiRingModel } from "./models/colmi-ring";
import { BANGLE_JS_MODELS } from "./models/bangle-js";
import { getXiaomiModel } from "./models/xiaomi";
import { getZeppOsModel } from "./models/zepp-os";
import { BLE_SCALE_MODELS } from "./models/ble-scale";
import { COLMI_RING_MODELS } from "./models/colmi-ring";
import { GLORYFIT_MODELS } from "./models/gloryfit";
import { HUAMI_LEGACY_MODELS } from "./models/huami-legacy";
import { CASIO_MODELS } from "./models/casio";
import { FITPRO_MODELS } from "./models/fitpro";
import { GARMIN_MODELS } from "./models/garmin";
import { HUAWEI_MODELS } from "./models/huawei";
import { XIAOMI_MODELS } from "./models/xiaomi";
import { ZEPP_OS_MODELS } from "./models/zepp-os";
import { describeDeviceSupport } from "./support-status";

test("the Helio Strap is the only source-validated Zepp OS model", () => {
  const strap = getZeppOsModel("amazfit_helio_strap");
  expect(strap?.transportValidated).toBe(true);
  expect(
    describeDeviceSupport({
      family: "zepp_os",
      modelId: "amazfit_helio_strap",
      transportValidated: strap?.transportValidated ?? false,
    }),
  ).toEqual({
    upstream: { listed: true, featureLevel: "most", experimental: true },
    openValens: "zepp_os_validated",
  });
});

test("other Zepp OS models report the shared, unvalidated transport", () => {
  const model = getZeppOsModel("amazfit_gtr_4");
  expect(
    describeDeviceSupport({
      family: "zepp_os",
      modelId: "amazfit_gtr_4",
      transportValidated: model?.transportValidated ?? false,
    }).openValens,
  ).toBe("zepp_os_shared");
});

test("Xiaomi models report the shared protobuf transport", () => {
  expect(
    describeDeviceSupport({
      family: "xiaomi",
      modelId: "xiaomi_mi_band_9",
      transportValidated: getXiaomiModel("xiaomi_mi_band_9")?.transportValidated ?? false,
    }).openValens,
  ).toBe("xiaomi_shared");
});

test("Huawei/Honor models report connection checks only", () => {
  expect(
    describeDeviceSupport({
      family: "huawei",
      modelId: "huawei_watch_gt_5",
      transportValidated: getHuaweiModel("huawei_watch_gt_5")?.transportValidated ?? false,
      sync: getHuaweiModel("huawei_watch_gt_5")?.sync,
    }).openValens,
  ).toBe("huawei_connection_only");
});

test("Huawei BLE models report history sync and Bluetooth-Classic models do not", () => {
  for (const id of ["honor_band_9", "huawei_band_11_pro", "huawei_watch_gt"] as const) {
    const model = getHuaweiModel(id);
    expect(model?.sync, id).toBe(true);
    expect(
      describeDeviceSupport({
        family: "huawei",
        modelId: id,
        transportValidated: model?.transportValidated ?? false,
        sync: model?.sync,
      }).openValens,
      id,
    ).toBe("huawei_history_sync");
  }
  for (const id of ["huawei_watch_gt_4", "huawei_watch_fit_3"] as const) {
    const model = getHuaweiModel(id);
    expect(model?.sync, id).toBe(false);
    expect(
      describeDeviceSupport({
        family: "huawei",
        modelId: id,
        transportValidated: model?.transportValidated ?? false,
        sync: model?.sync,
      }).openValens,
      id,
    ).toBe("huawei_connection_only");
  }
});

test("Garmin wearables report FIT history sync, other models connection checks only", () => {
  const fenix = getGarminModel("garmin_fenix_7");
  expect(
    describeDeviceSupport({
      family: "garmin",
      modelId: "garmin_fenix_7",
      transportValidated: fenix?.transportValidated ?? false,
      sync: fenix?.sync,
    }).openValens,
  ).toBe("garmin_history_sync");

  for (const modelId of ["garmin_edge_530", "garmin_gpsmap_66s", "garmin_hrm_200"]) {
    const model = getGarminModel(modelId as Parameters<typeof getGarminModel>[0]);
    expect(
      describeDeviceSupport({
        family: "garmin",
        modelId,
        transportValidated: model?.transportValidated ?? false,
        sync: model?.sync,
      }).openValens,
      modelId,
    ).toBe("garmin_connection_only");
  }
});

test("an id with no catalog entry is reported as unlisted, not as supported", () => {
  expect(
    describeDeviceSupport({
      family: "zepp_os",
      modelId: "not_a_real_model_id",
      transportValidated: false,
    }),
  ).toEqual({ upstream: { listed: false }, openValens: "zepp_os_shared" });
});

test("upstream feature level and experimental flag come from the catalog", () => {
  const experimental = describeDeviceSupport({
    family: "garmin",
    modelId: "garmin_fenix_5_plus",
    transportValidated: false,
  });
  expect(experimental.upstream).toEqual({
    listed: true,
    featureLevel: "partial",
    experimental: true,
  });

  const stable = describeDeviceSupport({
    family: "garmin",
    modelId: "garmin_fenix_7",
    transportValidated: false,
  });
  expect(stable.upstream).toEqual({
    listed: true,
    featureLevel: "most",
    experimental: false,
  });
});

test("every registered model has a catalog entry to show", () => {
  const families = [
    { family: "zepp_os" as const, models: ZEPP_OS_MODELS },
    { family: "xiaomi" as const, models: XIAOMI_MODELS },
    { family: "huawei" as const, models: HUAWEI_MODELS },
    { family: "garmin" as const, models: GARMIN_MODELS },
    { family: "ble_scale" as const, models: BLE_SCALE_MODELS },
    { family: "colmi_ring" as const, models: COLMI_RING_MODELS },
    { family: "gloryfit" as const, models: GLORYFIT_MODELS },
    { family: "huami_legacy" as const, models: HUAMI_LEGACY_MODELS },
  ];
  const unlisted = families.flatMap(({ family, models }) =>
    models
      .filter(
        (model) =>
          !describeDeviceSupport({
            family,
            modelId: model.id,
            transportValidated: model.transportValidated,
          }).upstream.listed,
      )
      .map((model) => model.id),
  );
  // Four legacy Huami coordinator classes have no row in upstream's YAML
  // catalog; the UI reports those as unlisted rather than inventing a rating.
  const huamiCatalogGaps = new Set([
    "amazfit_gtr_2e",
    "amazfit_gts_2e",
    "xiaomi_mi_band_2_hrx",
    "zepp_e",
  ]);
  expect(unlisted.filter((id) => !huamiCatalogGaps.has(id))).toEqual([]);
  expect([...unlisted].sort() as string[]).toEqual([...huamiCatalogGaps].sort());
});

test("generic GATT models report live capture only and no history backfill", () => {
  expect(
    describeDeviceSupport({
      family: "ble_gatt",
      modelId: "polar_h10",
      transportValidated: false,
    }),
  ).toEqual({
    upstream: { listed: true, featureLevel: "partial", experimental: false },
    openValens: "ble_gatt_live_capture",
  });
  // Generic fallback ids have no upstream catalog row; that is reported
  // honestly rather than guessed.
  expect(
    describeDeviceSupport({
      family: "ble_gatt",
      modelId: "generic_heart_rate_sensor",
      transportValidated: false,
    }).upstream,
  ).toEqual({ listed: false });
});

test("smart scales with a capture path report live capture", () => {
  const model = getBleScaleModel("xiaomi_body_composition_scale_2");
  expect(
    describeDeviceSupport({
      family: "ble_scale",
      modelId: "xiaomi_body_composition_scale_2",
      transportValidated: model?.transportValidated ?? false,
      records: model?.records,
    }),
  ).toEqual({
    upstream: { listed: true, featureLevel: "poor", experimental: false },
    openValens: "ble_scale_live_capture",
  });
});

test("smart scales without a capture path report connection checks only", () => {
  for (const id of ["chipsea_qn_scale", "ge_fit_plus", "viatom_f8"] as const) {
    const model = getBleScaleModel(id);
    expect(model?.records, id).toEqual([]);
    expect(
      describeDeviceSupport({
        family: "ble_scale",
        modelId: id,
        transportValidated: model?.transportValidated ?? false,
        records: model?.records,
      }).openValens,
      id,
    ).toBe("ble_scale_connection_only");
  }
});

test("rings report history sync, not live capture or validated support", () => {
  const model = getColmiRingModel("yawell_ai_health_watchpad");
  expect(
    describeDeviceSupport({
      family: "colmi_ring",
      modelId: "yawell_ai_health_watchpad",
      transportValidated: model?.transportValidated ?? false,
      records: model?.records,
    }),
  ).toEqual({
    upstream: { listed: true, featureLevel: "most", experimental: false },
    openValens: "colmi_ring_history_sync",
  });
});

test("Bangle.js reports history sync for steps and heart rate only", () => {
  for (const model of BANGLE_JS_MODELS) {
    expect(
      describeDeviceSupport({
        family: "bangle_js",
        modelId: model.id,
        transportValidated: model.transportValidated,
        records: model.records,
      }),
      model.id,
    ).toEqual({
      upstream: { listed: true, featureLevel: "high", experimental: false },
      openValens: "bangle_js_history_sync",
    });
  }
});

test("GloryFit reports history sync for steps, heart rate and sleep", () => {
  for (const model of GLORYFIT_MODELS) {
    expect(
      describeDeviceSupport({
        family: "gloryfit",
        modelId: model.id,
        transportValidated: model.transportValidated,
        records: model.records,
      }),
      model.id,
    ).toMatchObject({ openValens: "gloryfit_history_sync" });
  }
});

test("legacy Huami reports exact-minute steps history, not validated support", () => {
  for (const model of HUAMI_LEGACY_MODELS) {
    expect(
      describeDeviceSupport({
        family: "huami_legacy",
        modelId: model.id,
        transportValidated: model.transportValidated,
        records: model.records,
      }),
      model.id,
    ).toMatchObject({ openValens: "huami_legacy_steps_history" });
  }
});

test("FitPro reports history sync for 15-minute steps, sleep and realtime heart rate", () => {
  for (const model of FITPRO_MODELS) {
    expect(
      describeDeviceSupport({
        family: "fitpro",
        modelId: model.id,
        transportValidated: model.transportValidated,
        records: model.records,
      }),
      model.id,
    ).toMatchObject({ openValens: "fitpro_history_sync" });
  }
});

test("Casio reports hourly step buckets only where a fetch exists", () => {
  for (const model of CASIO_MODELS) {
    const hasSteps = model.records.includes("steps_interval");
    expect(
      describeDeviceSupport({
        family: "casio",
        modelId: model.id,
        transportValidated: model.transportValidated,
        records: model.records,
      }),
      model.id,
    ).toMatchObject({
      openValens: hasSteps ? "casio_steps_history" : "casio_connection_only",
    });
  }
  // The frozen contract has no heart rate and no sleep for this family.
  for (const model of CASIO_MODELS) {
    expect(model.records, model.id).not.toContain("heart_rate");
    expect(model.records, model.id).not.toContain("sleep_session");
  }
  // The GATT-server models are connection-only.
  expect(
    describeDeviceSupport({
      family: "casio",
      modelId: "casio_gb-6900b",
      transportValidated: false,
      records: [],
    }).openValens,
  ).toBe("casio_connection_only");
});
