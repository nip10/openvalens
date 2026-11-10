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
import { getXiaomiModel } from "./models/xiaomi";
import { getZeppOsModel } from "./models/zepp-os";
import { BLE_SCALE_MODELS } from "./models/ble-scale";
import { COLMI_RING_MODELS } from "./models/colmi-ring";
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
    }).openValens,
  ).toBe("huawei_connection_only");
});

test("Garmin models report connection checks only", () => {
  expect(
    describeDeviceSupport({
      family: "garmin",
      modelId: "garmin_fenix_7",
      transportValidated: getGarminModel("garmin_fenix_7")?.transportValidated ?? false,
    }).openValens,
  ).toBe("garmin_connection_only");
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
  expect(unlisted).toEqual([]);
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
