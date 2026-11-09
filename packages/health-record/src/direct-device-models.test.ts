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
  expect(DIRECT_DEVICE_MODELS).toHaveLength(304);
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
  expect(supportsDirectDeviceSteps({ family: "zepp_os", modelId: "amazfit_helio_strap" })).toBe(
    true,
  );
  expect(supportsDirectDeviceSteps({ family: "ble_gatt", modelId: "polar_h10" })).toBe(false);
  expect(supportsDirectDeviceSteps({ family: "garmin", modelId: "garmin_fenix_7" })).toBe(false);
  expect(isDirectDeviceIdentity({ family: "xiaomi", modelId: "xiaomi_mi_band_10" })).toBe(true);
  expect(isDirectDeviceIdentity({ family: "xiaomi", modelId: "garmin_fenix_7" })).toBe(false);
});
