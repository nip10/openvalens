/**
 * Keeps the public support status (`@openvalens/health-record/device-support-status`,
 * shown on the landing site's supported-devices page, #445) honest against the
 * native registries: a model the app cannot sync records from must never be
 * listed as "Works in testing" or better.
 */
import { expect, test } from "bun:test";

import { deviceSupport } from "@openvalens/health-record/device-support-status";

import { BANGLE_JS_MODELS } from "./models/bangle-js";
import { BLE_GATT_MODELS } from "./models/ble-gatt";
import { BLE_SCALE_MODELS } from "./models/ble-scale";
import { CASIO_MODELS } from "./models/casio";
import { COLMI_RING_MODELS } from "./models/colmi-ring";
import { FITPRO_MODELS } from "./models/fitpro";
import { FOSSIL_HR_MODELS } from "./models/fossil-hr";
import { GARMIN_MODELS } from "./models/garmin";
import { GLORYFIT_MODELS } from "./models/gloryfit";
import { HUAMI_LEGACY_MODELS } from "./models/huami-legacy";
import { HUAWEI_MODELS } from "./models/huawei";
import { MOYOUNG_MODELS } from "./models/moyoung";
import { PEBBLE_MODELS } from "./models/pebble";
import { XIAOMI_MODELS } from "./models/xiaomi";
import { ZEPP_OS_MODELS } from "./models/zepp-os";
import type { DirectDeviceFamily } from "./setup/types";
import { describeDeviceSupport, type OpenValensDeviceSupport } from "./support-status";

type RegistryModel = Readonly<{
  id: string;
  transportValidated: boolean;
  records?: readonly string[];
  sync?: boolean;
}>;

const REGISTRIES: readonly [DirectDeviceFamily, readonly RegistryModel[]][] = [
  ["zepp_os", ZEPP_OS_MODELS],
  ["xiaomi", XIAOMI_MODELS],
  ["huawei", HUAWEI_MODELS],
  ["garmin", GARMIN_MODELS],
  ["ble_gatt", BLE_GATT_MODELS],
  ["ble_scale", BLE_SCALE_MODELS],
  ["colmi_ring", COLMI_RING_MODELS],
  ["bangle_js", BANGLE_JS_MODELS],
  ["gloryfit", GLORYFIT_MODELS],
  ["huami_legacy", HUAMI_LEGACY_MODELS],
  ["moyoung", MOYOUNG_MODELS],
  ["fitpro", FITPRO_MODELS],
  ["casio", CASIO_MODELS],
  ["pebble", PEBBLE_MODELS],
  ["fossil_hr", FOSSIL_HR_MODELS],
];

/** Native statuses with no data path: connection checks only, or no transport. */
const NO_RECORDS: readonly OpenValensDeviceSupport[] = [
  "huawei_connection_only",
  "garmin_connection_only",
  "ble_scale_connection_only",
  "casio_connection_only",
  "pebble_bt_classic_unsupported",
];

test("models the app syncs no records from are experimental on the site", () => {
  const overclaimed: string[] = [];
  for (const [family, models] of REGISTRIES) {
    for (const model of models) {
      const native = describeDeviceSupport({
        family,
        modelId: model.id,
        transportValidated: model.transportValidated,
        records: model.records,
        sync: model.sync,
      }).openValens;
      if (!NO_RECORDS.includes(native)) continue;
      const site = deviceSupport({ family, modelId: model.id });
      if (site.status !== "experimental" || site.reason !== "no_records_yet") {
        overclaimed.push(`${model.id} (${native})`);
      }
    }
  }
  // Add each one to DEVICE_SUPPORT_EXCEPTIONS as NO_RECORDS.
  expect(overclaimed).toEqual([]);
});
