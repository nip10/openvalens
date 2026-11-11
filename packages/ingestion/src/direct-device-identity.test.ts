import { describe, expect, test } from "bun:test";

import {
  assertDirectDeviceIdentity,
  confirmedDirectDeviceIdentity,
  DirectDeviceIdentityError,
} from "./direct-device-identity";

const confirmed = { directDeviceFamily: "zepp_os", directDeviceModelId: "amazfit_helio_strap" };

describe("direct-device identity guard", () => {
  test("accepts only matching confirmed catalog identities", () => {
    expect(
      assertDirectDeviceIdentity(confirmed, { family: "zepp_os", modelId: "amazfit_helio_strap" }),
    ).toEqual({ family: "zepp_os", modelId: "amazfit_helio_strap" });
  });

  test("requires an identity assertion and rejects pair mismatches", () => {
    expect(() => assertDirectDeviceIdentity(confirmed)).toThrow(
      new DirectDeviceIdentityError("IDENTITY_REQUIRED"),
    );
    expect(() =>
      assertDirectDeviceIdentity(confirmed, { family: "xiaomi", modelId: "xiaomi_smart_band_7" }),
    ).toThrow(new DirectDeviceIdentityError("IDENTITY_MISMATCH"));
    expect(() =>
      confirmedDirectDeviceIdentity({ directDeviceFamily: null, directDeviceModelId: null }),
    ).toThrow(new DirectDeviceIdentityError("IDENTITY_REQUIRED"));
  });

  test("fails closed on unknown persisted pairs and unsupported history", () => {
    expect(() =>
      confirmedDirectDeviceIdentity({
        directDeviceFamily: "xiaomi",
        directDeviceModelId: "unknown",
      }),
    ).toThrow(new DirectDeviceIdentityError("IDENTITY_REQUIRED"));
    expect(() =>
      assertDirectDeviceIdentity(
        { directDeviceFamily: "garmin", directDeviceModelId: "garmin_fenix_7" },
        { family: "garmin", modelId: "garmin_fenix_7" },
        { recordType: "steps_interval" },
      ),
    ).toThrow(new DirectDeviceIdentityError("HISTORY_UNSUPPORTED"));
  });

  test("smart-scale weight measurements are ble_scale only", () => {
    const scale = { directDeviceFamily: "ble_scale", directDeviceModelId: "xiaomi_smart_scale_2" };
    const ble = { directDeviceFamily: "ble_gatt", directDeviceModelId: "polar_h10" };
    expect(
      assertDirectDeviceIdentity(
        scale,
        { family: "ble_scale", modelId: "xiaomi_smart_scale_2" },
        { recordType: "weight_measurement" },
      ),
    ).toEqual({ family: "ble_scale", modelId: "xiaomi_smart_scale_2" });
    expect(() =>
      assertDirectDeviceIdentity(
        confirmed,
        { family: "zepp_os", modelId: "amazfit_helio_strap" },
        { recordType: "weight_measurement" },
      ),
    ).toThrow(new DirectDeviceIdentityError("HISTORY_UNSUPPORTED"));
    expect(() =>
      assertDirectDeviceIdentity(
        ble,
        { family: "ble_gatt", modelId: "polar_h10" },
        { recordType: "weight_measurement" },
      ),
    ).toThrow(new DirectDeviceIdentityError("HISTORY_UNSUPPORTED"));
    expect(() =>
      assertDirectDeviceIdentity(
        scale,
        { family: "ble_scale", modelId: "xiaomi_smart_scale_2" },
        { recordType: "steps" },
      ),
    ).toThrow(new DirectDeviceIdentityError("HISTORY_UNSUPPORTED"));
    expect(() =>
      assertDirectDeviceIdentity(
        scale,
        { family: "ble_scale", modelId: "xiaomi_smart_scale_2" },
        { recordType: "body_temperature" },
      ),
    ).toThrow(new DirectDeviceIdentityError("HISTORY_UNSUPPORTED"));
  });

  test("interval steps are accepted from rings and Bangle.js, refused elsewhere", () => {
    const ring = { directDeviceFamily: "colmi_ring", directDeviceModelId: "colmi_r02" };
    const ringAssertion = { family: "colmi_ring", modelId: "colmi_r02" } as const;
    const bangle = { directDeviceFamily: "bangle_js", directDeviceModelId: "bangle_js_2" };
    const bangleAssertion = { family: "bangle_js", modelId: "bangle_js_2" } as const;
    for (const [binding, assertion] of [
      [ring, ringAssertion],
      [bangle, bangleAssertion],
    ] as const)
      expect(
        assertDirectDeviceIdentity(binding, assertion, { recordType: "steps_interval" }),
      ).toEqual(assertion);
    for (const other of [
      confirmed,
      { directDeviceFamily: "xiaomi", directDeviceModelId: "xiaomi_mi_band_10" },
      { directDeviceFamily: "ble_gatt", directDeviceModelId: "polar_h10" },
      { directDeviceFamily: "ble_scale", directDeviceModelId: "xiaomi_smart_scale_2" },
    ] as const)
      expect(() =>
        assertDirectDeviceIdentity(
          other,
          { family: other.directDeviceFamily, modelId: other.directDeviceModelId },
          { recordType: "steps_interval" },
        ),
      ).toThrow(new DirectDeviceIdentityError("HISTORY_UNSUPPORTED"));
    // Rings and Bangle.js report arbitrary buckets, never the exact-minute
    // `steps` history owned by the watch families.
    for (const [binding, assertion] of [
      [ring, ringAssertion],
      [bangle, bangleAssertion],
    ] as const)
      expect(() => assertDirectDeviceIdentity(binding, assertion, { recordType: "steps" })).toThrow(
        new DirectDeviceIdentityError("HISTORY_UNSUPPORTED"),
      );
  });

  test("sleep sessions are refused by families without sleep history", () => {
    const ring = { directDeviceFamily: "colmi_ring", directDeviceModelId: "colmi_r02" };
    const ringAssertion = { family: "colmi_ring", modelId: "colmi_r02" } as const;
    expect(
      assertDirectDeviceIdentity(ring, ringAssertion, { recordType: "sleep_session" }),
    ).toEqual(ringAssertion);
    for (const other of [
      confirmed,
      { directDeviceFamily: "xiaomi", directDeviceModelId: "xiaomi_mi_band_10" },
      { directDeviceFamily: "ble_gatt", directDeviceModelId: "polar_h10" },
      { directDeviceFamily: "ble_scale", directDeviceModelId: "xiaomi_smart_scale_2" },
      { directDeviceFamily: "bangle_js", directDeviceModelId: "bangle_js_2" },
    ] as const)
      expect(() =>
        assertDirectDeviceIdentity(
          other,
          { family: other.directDeviceFamily, modelId: other.directDeviceModelId },
          { recordType: "sleep_session" },
        ),
      ).toThrow(new DirectDeviceIdentityError("HISTORY_UNSUPPORTED"));
  });

  test("heart rate is accepted from BLE GATT sensors, rings and Bangle.js", () => {
    const ring = { directDeviceFamily: "colmi_ring", directDeviceModelId: "colmi_r02" };
    const ringAssertion = { family: "colmi_ring", modelId: "colmi_r02" } as const;
    const bangle = { directDeviceFamily: "bangle_js", directDeviceModelId: "bangle_js_2" };
    const bangleAssertion = { family: "bangle_js", modelId: "bangle_js_2" } as const;
    const pineTime = { directDeviceFamily: "ble_gatt", directDeviceModelId: "pinetime_p8" };
    const pineTimeAssertion = { family: "ble_gatt", modelId: "pinetime_p8" } as const;
    for (const [binding, assertion] of [
      [ring, ringAssertion],
      [bangle, bangleAssertion],
      [pineTime, pineTimeAssertion],
    ] as const)
      expect(assertDirectDeviceIdentity(binding, assertion, { recordType: "heart_rate" })).toEqual(
        assertion,
      );
    // Temperature and blood pressure remain BLE GATT sensor only.
    for (const [binding, assertion] of [
      [ring, ringAssertion],
      [bangle, bangleAssertion],
    ] as const)
      for (const recordType of ["body_temperature", "blood_pressure"] as const)
        expect(() => assertDirectDeviceIdentity(binding, assertion, { recordType })).toThrow(
          new DirectDeviceIdentityError("HISTORY_UNSUPPORTED"),
        );
  });

  test("GloryFit watches publish interval steps, heart rate and sleep sessions", () => {
    const gloryfit = { directDeviceFamily: "gloryfit", directDeviceModelId: "gloryfit_d3" };
    const assertion = { family: "gloryfit", modelId: "gloryfit_d3" } as const;
    // Hourly steps arrive as interval buckets, heart rate as 10-minute blocks
    // and sleep as staged sessions.
    for (const recordType of ["steps_interval", "heart_rate", "sleep_session"] as const)
      expect(assertDirectDeviceIdentity(gloryfit, assertion, { recordType })).toEqual(assertion);
    // GloryFit has no exact-minute step history, scale or GATT sensor metrics.
    for (const recordType of [
      "steps",
      "weight_measurement",
      "body_temperature",
      "blood_pressure",
    ] as const)
      expect(() => assertDirectDeviceIdentity(gloryfit, assertion, { recordType })).toThrow(
        new DirectDeviceIdentityError("HISTORY_UNSUPPORTED"),
      );
  });

  test("legacy Huami devices publish exact-minute steps, heart rate and sleep sessions", () => {
    const huami = { directDeviceFamily: "huami_legacy", directDeviceModelId: "amazfit_bip" };
    const assertion = { family: "huami_legacy", modelId: "amazfit_bip" } as const;
    // Per-minute activity samples carry exact-minute steps and heart rate;
    // sleep is derived from activity kinds 9/11.
    for (const recordType of ["steps", "heart_rate", "sleep_session"] as const)
      expect(assertDirectDeviceIdentity(huami, assertion, { recordType })).toEqual(assertion);
    // Legacy Huami has no interval buckets, scale or GATT sensor metrics.
    for (const recordType of [
      "steps_interval",
      "weight_measurement",
      "body_temperature",
      "blood_pressure",
    ] as const)
      expect(() => assertDirectDeviceIdentity(huami, assertion, { recordType })).toThrow(
        new DirectDeviceIdentityError("HISTORY_UNSUPPORTED"),
      );
  });

  test("Huawei devices publish exact-minute steps, heart rate and sleep sessions", () => {
    const huawei = { directDeviceFamily: "huawei", directDeviceModelId: "huawei_band_8" };
    const assertion = { family: "huawei", modelId: "huawei_band_8" } as const;
    // Per-minute bitmap samples carry steps and heart rate inline; sleep comes
    // from 0x0D records. Only BLE-transport models reach this point: the native
    // registry refuses BT-Classic models before a batch exists.
    for (const recordType of ["steps", "heart_rate", "sleep_session"] as const)
      expect(assertDirectDeviceIdentity(huawei, assertion, { recordType })).toEqual(assertion);
    // Huawei has no interval buckets, scale or GATT sensor metrics.
    for (const recordType of [
      "steps_interval",
      "weight_measurement",
      "body_temperature",
      "blood_pressure",
    ] as const)
      expect(() => assertDirectDeviceIdentity(huawei, assertion, { recordType })).toThrow(
        new DirectDeviceIdentityError("HISTORY_UNSUPPORTED"),
      );
  });

  test("Garmin devices publish exact-minute steps, heart rate and sleep sessions", () => {
    const garmin = { directDeviceFamily: "garmin", directDeviceModelId: "garmin_fenix_7" };
    const assertion = { family: "garmin", modelId: "garmin_fenix_7" } as const;
    // FIT monitoring samples are per-minute, so they map to exact-minute steps
    // and heart rate; sleep sessions come from the same FIT files. Only
    // BLE-transport models reach this point: the native registry refuses
    // Bluetooth-Classic/RFCOMM models before a batch exists.
    for (const recordType of ["steps", "heart_rate", "sleep_session"] as const)
      expect(assertDirectDeviceIdentity(garmin, assertion, { recordType })).toEqual(assertion);
    // Garmin has no interval buckets, scale or GATT sensor metrics.
    for (const recordType of [
      "steps_interval",
      "weight_measurement",
      "body_temperature",
      "blood_pressure",
    ] as const)
      expect(() => assertDirectDeviceIdentity(garmin, assertion, { recordType })).toThrow(
        new DirectDeviceIdentityError("HISTORY_UNSUPPORTED"),
      );
  });

  test("Moyoung watches publish heart rate and sleep sessions only", () => {
    const moyoung = { directDeviceFamily: "moyoung", directDeviceModelId: "moyoung_c20" };
    const assertion = { family: "moyoung", modelId: "moyoung_c20" } as const;
    // v1 ships heart-rate history and sleep; daily-total steps are deliberately
    // not mapped.
    for (const recordType of ["heart_rate", "sleep_session"] as const)
      expect(assertDirectDeviceIdentity(moyoung, assertion, { recordType })).toEqual(assertion);
    for (const recordType of [
      "steps",
      "steps_interval",
      "weight_measurement",
      "body_temperature",
      "blood_pressure",
    ] as const)
      expect(() => assertDirectDeviceIdentity(moyoung, assertion, { recordType })).toThrow(
        new DirectDeviceIdentityError("HISTORY_UNSUPPORTED"),
      );
  });

  test("record-type capability separates watch steps from BLE GATT sensors", () => {
    const ble = { directDeviceFamily: "ble_gatt", directDeviceModelId: "polar_h10" };
    expect(
      assertDirectDeviceIdentity(
        ble,
        { family: "ble_gatt", modelId: "polar_h10" },
        { recordType: "heart_rate" },
      ),
    ).toEqual({ family: "ble_gatt", modelId: "polar_h10" });
    expect(() =>
      assertDirectDeviceIdentity(
        ble,
        { family: "ble_gatt", modelId: "polar_h10" },
        {
          recordType: "steps",
        },
      ),
    ).toThrow(new DirectDeviceIdentityError("HISTORY_UNSUPPORTED"));
    expect(() =>
      assertDirectDeviceIdentity(
        confirmed,
        { family: "zepp_os", modelId: "amazfit_helio_strap" },
        {
          recordType: "body_temperature",
        },
      ),
    ).toThrow(new DirectDeviceIdentityError("HISTORY_UNSUPPORTED"));
    expect(() =>
      assertDirectDeviceIdentity(
        confirmed,
        { family: "zepp_os", modelId: "amazfit_helio_strap" },
        {
          recordType: "blood_pressure",
        },
      ),
    ).toThrow(new DirectDeviceIdentityError("HISTORY_UNSUPPORTED"));
    expect(
      assertDirectDeviceIdentity(
        confirmed,
        { family: "zepp_os", modelId: "amazfit_helio_strap" },
        {
          recordType: "steps",
        },
      ),
    ).toEqual({ family: "zepp_os", modelId: "amazfit_helio_strap" });
  });
});
