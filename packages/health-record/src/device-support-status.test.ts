import { expect, test } from "bun:test";

import {
  DEVICE_SUPPORT_EXCEPTIONS,
  DEVICE_SUPPORT_STATUSES,
  deviceSupport,
  directDeviceSupportList,
  EXPERIMENTAL_FAMILIES,
} from "./device-support-status";
import { DIRECT_DEVICE_FAMILIES, DIRECT_DEVICE_MODELS } from "./direct-device-models";

const MODEL_IDS = new Set(DIRECT_DEVICE_MODELS.map((model) => model.modelId));

test("model ids are unique across families, so a status can be keyed by model id", () => {
  expect(MODEL_IDS.size).toBe(DIRECT_DEVICE_MODELS.length);
});

test("every status key is a real model id", () => {
  const unknown = Object.keys(DEVICE_SUPPORT_EXCEPTIONS).filter((id) => !MODEL_IDS.has(id));
  expect(unknown).toEqual([]);
});

test("every experimental family is a real family", () => {
  for (const family of Object.keys(EXPERIMENTAL_FAMILIES)) {
    expect(DIRECT_DEVICE_FAMILIES).toContain(family as (typeof DIRECT_DEVICE_FAMILIES)[number]);
  }
});

test("every registered model gets one of the three statuses", () => {
  const list = directDeviceSupportList();
  expect(list).toHaveLength(DIRECT_DEVICE_MODELS.length);
  for (const { support } of list) expect(DEVICE_SUPPORT_STATUSES).toContain(support.status);
});

test("no model is tested on a device until the owner says so", () => {
  // Remove this test when the owner adds the first hardware-tested model.
  expect(directDeviceSupportList().filter((m) => m.support.status === "tested")).toEqual([]);
});

test("models default to works_in_testing; Pebble, upstream-experimental and no-data models do not", () => {
  expect(deviceSupport({ family: "garmin", modelId: "garmin_fenix_7" }).status).toBe(
    "works_in_testing",
  );
  expect(deviceSupport({ family: "pebble", modelId: "pebble_2_duo" })).toEqual({
    status: "experimental",
    reason: "new_capture_path",
  });
  expect(deviceSupport({ family: "pebble", modelId: "pebble_classic" })).toEqual({
    status: "experimental",
    reason: "no_records_yet",
  });
  expect(deviceSupport({ family: "huawei", modelId: "huawei_watch_gt_5" })).toEqual({
    status: "experimental",
    reason: "no_records_yet",
  });
  expect(deviceSupport({ family: "garmin", modelId: "garmin_cirqa" })).toEqual({
    status: "experimental",
    reason: "upstream_experimental",
  });
  expect(deviceSupport({ family: "zepp_os", modelId: "amazfit_helio_strap" }).status).toBe(
    "works_in_testing",
  );
});
