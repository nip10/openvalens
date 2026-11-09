/**
 * Per-model support status for the direct-device settings screen.
 *
 * Two independent facts are kept separate so the UI never inflates them:
 *
 *  - `upstream` is what Gadgetbridge publishes about the model in its
 *    `device_support.yml` catalog (reference data, attributed in the UI).
 *  - `openValens` is what this codebase actually implements for the model's
 *    protocol family. Only the Amazfit Helio Strap has source-level transport
 *    validation, and no model has hardware validation.
 *
 * This module returns keys, not copy: the component maps them through the
 * Lingui `t` macro so every label stays translatable.
 */
import { findGadgetbridgeDevice } from "@openvalens/health-record/device-catalog";
import type { GadgetbridgeFeatureLevel } from "@openvalens/health-record/device-catalog";

import type { DirectDeviceFamily } from "./setup/types";

/**
 * Upstream catalog status. `listed: false` means the model id has no entry;
 * that is not evidence of support or of a lack of support, so the UI says so
 * plainly instead of guessing.
 */
export type UpstreamDeviceSupport =
  | Readonly<{ listed: false }>
  | Readonly<{
      listed: true;
      featureLevel: GadgetbridgeFeatureLevel;
      experimental: boolean;
    }>;

/**
 * What OpenValens implements for the device's family. The `*_validated`
 * variant is source-level only; none of these variants is a hardware claim.
 */
export type OpenValensDeviceSupport =
  | "zepp_os_validated"
  | "zepp_os_shared"
  | "xiaomi_shared"
  | "huawei_connection_only"
  | "garmin_connection_only"
  | "ble_gatt_live_capture";

export type DeviceSupportStatus = Readonly<{
  upstream: UpstreamDeviceSupport;
  openValens: OpenValensDeviceSupport;
}>;

/** Combines the upstream catalog entry with the family's OpenValens status. */
export function describeDeviceSupport(input: {
  family: DirectDeviceFamily;
  /** Stable upstream id shared by the registries and the catalog. */
  modelId: string;
  /** Registry flag; true only for the Zepp OS model validated at source level. */
  transportValidated: boolean;
}): DeviceSupportStatus {
  const catalogEntry = findGadgetbridgeDevice(input.modelId);
  return {
    upstream: catalogEntry
      ? {
          listed: true,
          featureLevel: catalogEntry.featureLevel,
          experimental: catalogEntry.experimental,
        }
      : { listed: false },
    openValens: openValensSupport(input.family, input.transportValidated),
  };
}

function openValensSupport(
  family: DirectDeviceFamily,
  transportValidated: boolean,
): OpenValensDeviceSupport {
  switch (family) {
    case "zepp_os":
      return transportValidated ? "zepp_os_validated" : "zepp_os_shared";
    case "xiaomi":
      return "xiaomi_shared";
    case "huawei":
      return "huawei_connection_only";
    case "garmin":
      return "garmin_connection_only";
    case "ble_gatt":
      return "ble_gatt_live_capture";
  }
}
