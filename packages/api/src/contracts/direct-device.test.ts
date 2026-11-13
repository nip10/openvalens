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

  test("accepts body-temperature batches inside the plausible range", () => {
    const temperature = {
      type: "body_temperature",
      externalRecordId: "temp-1",
      sourceApp: null,
      startTime: steps.startTime,
      endTime: steps.endTime,
      celsius: 36.6,
    };
    const temperatureBatch = { ...batch, recordType: "body_temperature", upserts: [temperature] };
    expect(directDeviceBatch.safeParse(temperatureBatch).success).toBe(true);
    expect(
      directDeviceBatch.safeParse({
        ...temperatureBatch,
        upserts: [{ ...temperature, celsius: 24.9 }],
      }).success,
    ).toBe(false);
    expect(
      directDeviceBatch.safeParse({
        ...temperatureBatch,
        upserts: [{ ...temperature, celsius: 45.1 }],
      }).success,
    ).toBe(false);
    expect(
      directDeviceBatch.safeParse({
        ...temperatureBatch,
        upserts: [{ ...temperature, celsius: -1 }],
      }).success,
    ).toBe(false);
  });

  test("accepts HRV, resting heart rate and workout batches within their ranges", () => {
    const window = { startTime: steps.startTime, endTime: steps.endTime };
    const hrv = {
      type: "hrv_rmssd",
      externalRecordId: "hrv-1",
      sourceApp: null,
      ...window,
      rmssdMs: 42,
    };
    const rhr = {
      type: "resting_heart_rate",
      externalRecordId: "rhr-1",
      sourceApp: null,
      ...window,
      bpm: 52,
    };
    const workout = {
      type: "workout",
      externalRecordId: "wk-1",
      sourceApp: null,
      ...window,
      activity: "running",
      title: null,
    };
    const of = (recordType: string, record: object) => ({
      ...batch,
      recordType,
      upserts: [record],
    });
    expect(directDeviceBatch.safeParse(of("hrv_rmssd", hrv)).success).toBe(true);
    expect(directDeviceBatch.safeParse(of("resting_heart_rate", rhr)).success).toBe(true);
    expect(directDeviceBatch.safeParse(of("workout", workout)).success).toBe(true);
    expect(directDeviceBatch.safeParse(of("hrv_rmssd", { ...hrv, rmssdMs: 0 })).success).toBe(
      false,
    );
    expect(directDeviceBatch.safeParse(of("hrv_rmssd", { ...hrv, rmssdMs: 501 })).success).toBe(
      false,
    );
    expect(
      directDeviceBatch.safeParse(of("resting_heart_rate", { ...rhr, bpm: 52.5 })).success,
    ).toBe(false);
    expect(directDeviceBatch.safeParse(of("resting_heart_rate", { ...rhr, bpm: 19 })).success).toBe(
      false,
    );
    expect(directDeviceBatch.safeParse(of("workout", { ...workout, activity: "" })).success).toBe(
      false,
    );
    expect(directDeviceBatch.safeParse(of("workout", hrv)).success).toBe(false);
    expect(
      directDeviceBatch.safeParse(
        of("resting_heart_rate", { ...rhr, lastModifiedAt: "2026-10-02T20:00:00Z" }),
      ).success,
    ).toBe(true);
    expect(
      directDeviceBatch.safeParse(
        of("hrv_rmssd", { ...hrv, lastModifiedAt: "2026-10-02T20:00:00Z" }),
      ).success,
    ).toBe(false);
  });

  test("accepts blood-pressure batches and enforces ranges and diastolic < systolic", () => {
    const bloodPressure = {
      type: "blood_pressure",
      externalRecordId: "bp-1",
      sourceApp: null,
      startTime: steps.startTime,
      endTime: steps.endTime,
      systolic: 120,
      diastolic: 80,
      meanArterialPressure: 93,
      pulseRate: 60,
    };
    const bpBatch = { ...batch, recordType: "blood_pressure", upserts: [bloodPressure] };
    expect(directDeviceBatch.safeParse(bpBatch).success).toBe(true);
    expect(
      directDeviceBatch.safeParse({
        ...bpBatch,
        upserts: [{ ...bloodPressure, meanArterialPressure: undefined, pulseRate: undefined }],
      }).success,
    ).toBe(true);
    expect(
      directDeviceBatch.safeParse({
        ...bpBatch,
        upserts: [{ ...bloodPressure, diastolic: 120 }],
      }).success,
    ).toBe(false);
    expect(
      directDeviceBatch.safeParse({
        ...bpBatch,
        upserts: [{ ...bloodPressure, systolic: 49 }],
      }).success,
    ).toBe(false);
    expect(
      directDeviceBatch.safeParse({
        ...bpBatch,
        upserts: [{ ...bloodPressure, diastolic: 201 }],
      }).success,
    ).toBe(false);
    expect(
      directDeviceBatch.safeParse({
        ...bpBatch,
        upserts: [{ ...bloodPressure, meanArterialPressure: 251 }],
      }).success,
    ).toBe(false);
    expect(
      directDeviceBatch.safeParse({
        ...bpBatch,
        upserts: [{ ...bloodPressure, pulseRate: 19 }],
      }).success,
    ).toBe(false);
  });

  test("accepts weight measurements and enforces weight/impedance ranges", () => {
    const weight = {
      type: "weight_measurement",
      externalRecordId: "scale-1",
      sourceApp: null,
      startTime: steps.startTime,
      weightKg: 72.4,
      impedanceOhm: 480,
    };
    const weightBatch = { ...batch, recordType: "weight_measurement", upserts: [weight] };
    expect(directDeviceBatch.safeParse(weightBatch).success).toBe(true);
    expect(
      directDeviceBatch.safeParse({
        ...weightBatch,
        upserts: [{ ...weight, impedanceOhm: undefined }],
      }).success,
    ).toBe(true);
    for (const weightKg of [1.9, 500.1, 0]) {
      expect(
        directDeviceBatch.safeParse({ ...weightBatch, upserts: [{ ...weight, weightKg }] }).success,
      ).toBe(false);
    }
    for (const impedanceOhm of [199, 1201]) {
      expect(
        directDeviceBatch.safeParse({ ...weightBatch, upserts: [{ ...weight, impedanceOhm }] })
          .success,
      ).toBe(false);
    }
    expect(
      directDeviceBatch.safeParse({
        ...weightBatch,
        upserts: [{ ...weight, endTime: steps.endTime }],
      }).success,
    ).toBe(false);
    expect(
      directDeviceBatch.safeParse({
        ...weightBatch,
        recordType: "body_temperature",
      }).success,
    ).toBe(false);
  });

  test("accepts 15-minute steps intervals and rejects non-positive or hour-plus intervals", () => {
    const bucket = {
      type: "steps_interval",
      externalRecordId: "bucket-1",
      sourceApp: null,
      startTime: "2026-10-01T07:00:00.000Z",
      endTime: "2026-10-01T07:15:00.000Z",
      count: 250,
    };
    const intervalBatch = { ...batch, recordType: "steps_interval", upserts: [bucket] };
    expect(directDeviceBatch.safeParse(intervalBatch).success).toBe(true);
    for (const endTime of [
      bucket.startTime,
      "2026-10-01T06:59:00.000Z",
      "2026-10-01T08:00:01.000Z",
    ])
      expect(
        directDeviceBatch.safeParse({ ...intervalBatch, upserts: [{ ...bucket, endTime }] })
          .success,
      ).toBe(false);
    expect(
      directDeviceBatch.safeParse({ ...intervalBatch, upserts: [{ ...bucket, count: -1 }] })
        .success,
    ).toBe(false);
    expect(
      directDeviceBatch.safeParse({
        ...intervalBatch,
        upserts: [{ ...steps }],
      }).success,
    ).toBe(false);
  });

  test("accepts ring sleep sessions with ordered stages and rejects bad ordering", () => {
    const sleep = {
      type: "sleep_session",
      externalRecordId: "sleep-1",
      sourceApp: null,
      startTime: "2026-09-30T23:00:00.000Z",
      endTime: "2026-10-01T07:00:00.000Z",
      stages: [
        {
          stage: "light",
          startTime: "2026-09-30T23:00:00.000Z",
          endTime: "2026-10-01T00:00:00.000Z",
        },
        {
          stage: "deep",
          startTime: "2026-10-01T00:00:00.000Z",
          endTime: "2026-10-01T01:00:00.000Z",
        },
        {
          stage: "rem",
          startTime: "2026-10-01T01:00:00.000Z",
          endTime: "2026-10-01T02:00:00.000Z",
        },
      ],
    };
    const sleepBatch = { ...batch, recordType: "sleep_session", upserts: [sleep] };
    expect(directDeviceBatch.safeParse(sleepBatch).success).toBe(true);
    expect(
      directDeviceBatch.safeParse({
        ...sleepBatch,
        upserts: [{ ...sleep, stages: undefined }],
      }).success,
    ).toBe(true);
    // Out of order: the deep stage starts before the light stage ends.
    expect(
      directDeviceBatch.safeParse({
        ...sleepBatch,
        upserts: [
          {
            ...sleep,
            stages: [sleep.stages[1], sleep.stages[0], sleep.stages[2]],
          },
        ],
      }).success,
    ).toBe(false);
    // Overlapping stages are rejected even when each is individually valid.
    expect(
      directDeviceBatch.safeParse({
        ...sleepBatch,
        upserts: [
          {
            ...sleep,
            stages: [
              sleep.stages[0],
              { ...sleep.stages[1], startTime: "2026-09-30T23:30:00.000Z" },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      directDeviceBatch.safeParse({
        ...sleepBatch,
        upserts: [{ ...sleep, stages: [{ ...sleep.stages[0], stage: "asleep" }] }],
      }).success,
    ).toBe(false);
    expect(
      directDeviceBatch.safeParse({
        ...sleepBatch,
        upserts: [{ ...sleep, endTime: sleep.startTime }],
      }).success,
    ).toBe(false);
    expect(
      directDeviceBatch.safeParse({
        ...sleepBatch,
        recordType: "steps_interval",
        upserts: [{ ...steps }],
      }).success,
    ).toBe(false);
  });

  test("rejects upserts whose type does not match the batch recordType", () => {
    expect(
      directDeviceBatch.safeParse({
        ...batch,
        recordType: "body_temperature",
        upserts: [steps],
      }).success,
    ).toBe(false);
  });
});
