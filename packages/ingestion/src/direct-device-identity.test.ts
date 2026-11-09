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
