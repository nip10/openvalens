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
        { recordType: "steps" },
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

  test("ring intervals and sleep sessions are colmi_ring only", () => {
    const ring = { directDeviceFamily: "colmi_ring", directDeviceModelId: "colmi_r02" };
    const ringAssertion = { family: "colmi_ring", modelId: "colmi_r02" } as const;
    for (const recordType of ["steps_interval", "sleep_session"] as const) {
      expect(assertDirectDeviceIdentity(ring, ringAssertion, { recordType })).toEqual(
        ringAssertion,
      );
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
            { recordType },
          ),
        ).toThrow(new DirectDeviceIdentityError("HISTORY_UNSUPPORTED"));
    }
    // Rings report arbitrary buckets, never the exact-minute `steps` history.
    expect(() => assertDirectDeviceIdentity(ring, ringAssertion, { recordType: "steps" })).toThrow(
      new DirectDeviceIdentityError("HISTORY_UNSUPPORTED"),
    );
  });

  test("ring heart rate is accepted alongside BLE GATT sensors", () => {
    const ring = { directDeviceFamily: "colmi_ring", directDeviceModelId: "colmi_r02" };
    const ringAssertion = { family: "colmi_ring", modelId: "colmi_r02" } as const;
    expect(assertDirectDeviceIdentity(ring, ringAssertion, { recordType: "heart_rate" })).toEqual(
      ringAssertion,
    );
    // Temperature and blood pressure remain BLE GATT sensor only.
    for (const recordType of ["body_temperature", "blood_pressure"] as const)
      expect(() => assertDirectDeviceIdentity(ring, ringAssertion, { recordType })).toThrow(
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
