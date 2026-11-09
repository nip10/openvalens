import { describe, expect, test } from "bun:test";

import {
  directDeviceBatch,
  directDeviceRefusalReason,
  directDeviceBindingSummary,
  listDirectDevicesInput,
  listDirectDevicesOutput,
  ingestDirectDeviceBatchInput,
  registerDirectDeviceInput,
} from "./direct-device";
import { ingestBatchInput } from "./mobile-ingest";

const context = { userId: "u1", organizationId: "o1" };

test("direct-device refusal reasons are fixed safe categories", () => {
  expect(directDeviceRefusalReason.parse("REVOKED")).toBe("REVOKED");
  expect(directDeviceRefusalReason.parse("UNAVAILABLE")).toBe("UNAVAILABLE");
  expect(directDeviceRefusalReason.safeParse("user-123").success).toBe(false);
});

test("direct-device binding publication contract exposes only owned public binding metadata", () => {
  expect(directDeviceRefusalReason.parse("MINUTE_CONFLICT")).toBe("MINUTE_CONFLICT");
  expect(directDeviceRefusalReason.parse("IDENTITY_REQUIRED")).toBe("IDENTITY_REQUIRED");
  expect(directDeviceRefusalReason.parse("IDENTITY_MISMATCH")).toBe("IDENTITY_MISMATCH");
  expect(directDeviceRefusalReason.parse("HISTORY_UNSUPPORTED")).toBe("HISTORY_UNSUPPORTED");
  const expectedContext = { userId: "user", organizationId: "org" };
  expect(listDirectDevicesInput.parse({ expectedContext })).toEqual({ expectedContext });
  const binding = {
    deviceId: "6f1c2a3e-9b2d-4c1e-8f3a-2d7e5b9c0a11",
    providerConnectionId: 1,
    family: null,
    modelId: null,
    displayName: null,
    connectedAt: "2026-10-01T12:00:00.000Z",
    lastSyncedAt: null,
    publication: { policy: "phone_cloud_first_utc_day", publishedRecords: 4, shadowedRecords: 2 },
  } as const;
  expect(directDeviceBindingSummary.parse(binding)).toEqual(binding);
  expect(listDirectDevicesOutput.parse({ devices: [binding] })).toEqual({ devices: [binding] });
  expect(
    directDeviceBindingSummary.safeParse({ ...binding, macAddress: "must-not-be-public" }).success,
  ).toBe(false);
});
const steps = {
  type: "steps",
  externalRecordId: "segment-1",
  sourceApp: null,
  startTime: "2026-10-01T07:00:00.000Z",
  endTime: "2026-10-01T07:01:00.000Z",
  count: 10,
};
const batch = {
  schemaVersion: 1,
  deviceId: "6f1c2a3e-9b2d-4c1e-8f3a-2d7e5b9c0a11",
  provider: "direct_device",
  recordType: "steps",
  mode: "backfill",
  upserts: [steps],
  deletions: [],
  clientTimezone: "Europe/Lisbon",
};

describe("direct device contract", () => {
  test("accepts exact register and batch contracts", () => {
    expect(
      registerDirectDeviceInput.safeParse({
        deviceId: batch.deviceId,
        family: "amazfit_helio_strap",
        expectedContext: context,
      }).success,
    ).toBe(true);
    expect(
      registerDirectDeviceInput.safeParse({
        deviceId: batch.deviceId,
        family: "zepp_os",
        modelId: "amazfit_helio_strap",
        expectedContext: context,
      }).success,
    ).toBe(true);
    expect(
      registerDirectDeviceInput.safeParse({
        deviceId: batch.deviceId,
        family: "zepp_os",
        expectedContext: context,
      }).success,
    ).toBe(false);
    expect(
      registerDirectDeviceInput.safeParse({
        deviceId: batch.deviceId,
        family: "amazfit_helio_strap",
        modelId: "amazfit_helio_strap",
        expectedContext: context,
      }).success,
    ).toBe(false);
    expect(
      registerDirectDeviceInput.safeParse({
        deviceId: batch.deviceId,
        family: "xiaomi",
        modelId: "amazfit_helio_strap",
        expectedContext: context,
      }).success,
    ).toBe(false);
    expect(
      ingestDirectDeviceBatchInput.safeParse({ expectedContext: context, batch }).success,
    ).toBe(true);
  });

  test("rejects caller-controlled provenance and invalid batch semantics", () => {
    expect(ingestBatchInput.safeParse(batch).success).toBe(false);
    expect(
      directDeviceBatch.safeParse({ ...batch, upserts: [{ ...steps, sourceApp: "spoof" }] })
        .success,
    ).toBe(false);
    expect(
      directDeviceBatch.safeParse({
        ...batch,
        upserts: [{ ...steps, sourceDevice: { model: "other" } }],
      }).success,
    ).toBe(false);
    expect(
      directDeviceBatch.safeParse({ ...batch, upserts: [{ ...steps, endTime: steps.startTime }] })
        .success,
    ).toBe(false);
    expect(
      directDeviceBatch.safeParse({
        ...batch,
        upserts: [{ ...steps, endTime: "2026-10-01T07:02:00.000Z" }],
      }).success,
    ).toBe(false);
    expect(
      directDeviceBatch.safeParse({ ...batch, deletions: [{ externalRecordId: "x" }] }).success,
    ).toBe(false);
    expect(
      ingestDirectDeviceBatchInput.safeParse({ expectedContext: context, batch, userId: "u2" })
        .success,
    ).toBe(false);
  });

  test("heart-rate samples must be inside their ordered interval", () => {
    const hrBatch = {
      ...batch,
      recordType: "heart_rate",
      upserts: [
        {
          type: "heart_rate",
          externalRecordId: "hr",
          sourceApp: null,
          startTime: steps.startTime,
          endTime: steps.endTime,
          samples: [{ time: steps.endTime, bpm: 72 }],
        },
      ],
    };
    expect(directDeviceBatch.safeParse(hrBatch).success).toBe(true);
    expect(
      directDeviceBatch.safeParse({
        ...hrBatch,
        upserts: [
          { ...hrBatch.upserts[0], samples: [{ time: "2026-10-01T08:00:01.000Z", bpm: 72 }] },
        ],
      }).success,
    ).toBe(false);
  });
});
