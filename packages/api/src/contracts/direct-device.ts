import { z } from "zod";
import {
  DIRECT_DEVICE_FAMILIES,
  findDirectDeviceModel,
  type DirectDeviceIdentity,
} from "@openvalens/health-record/direct-device-models";
export type {
  DirectDeviceFamily,
  DirectDeviceIdentity,
  DirectDeviceModelDescriptor,
} from "@openvalens/health-record/direct-device-models";
export {
  DIRECT_DEVICE_FAMILIES,
  DIRECT_DEVICE_MODELS,
  findDirectDeviceModel,
  isDirectDeviceIdentity,
  supportsDirectDeviceSteps,
} from "@openvalens/health-record/direct-device-models";

import { ingestBatchOutput, isoUtc, registerDeviceOutput } from "./mobile-ingest";

export const DIRECT_DEVICE_PROVIDER = "direct_device" as const;
export const DIRECT_DEVICE_FAMILY = "amazfit_helio_strap" as const;
export const directDeviceIdentity = z
  .strictObject({ family: z.enum(DIRECT_DEVICE_FAMILIES), modelId: z.string().min(1) })
  .refine(
    (identity) => findDirectDeviceModel(identity as DirectDeviceIdentity) !== undefined,
    "Unknown direct-device model pair.",
  );

/** Safe, stable refusal categories for clients; deliberately excludes identity details. */
export const directDeviceRefusalReason = z.enum([
  "REVOKED",
  "UNAVAILABLE",
  "MINUTE_CONFLICT",
  "IDENTITY_REQUIRED",
  "IDENTITY_MISMATCH",
  "HISTORY_UNSUPPORTED",
]);
export type DirectDeviceRefusalReason = z.infer<typeof directDeviceRefusalReason>;

export const directDeviceContext = z.strictObject({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
});
export type DirectDeviceContext = z.infer<typeof directDeviceContext>;

export const directDevicePublication = z.strictObject({
  policy: z.literal("phone_cloud_first_utc_day"),
  publishedRecords: z.number().int().nonnegative(),
  shadowedRecords: z.number().int().nonnegative(),
});
export type DirectDevicePublication = z.infer<typeof directDevicePublication>;

export const directDeviceBindingSummary = z.strictObject({
  deviceId: z.uuid(),
  providerConnectionId: z.number().int().positive(),
  family: z.enum(DIRECT_DEVICE_FAMILIES).nullable(),
  modelId: z.string().nullable(),
  displayName: z.string().nullable(),
  connectedAt: isoUtc,
  lastSyncedAt: isoUtc.nullable(),
  publication: directDevicePublication,
});
export type DirectDeviceBindingSummary = z.infer<typeof directDeviceBindingSummary>;

export const listDirectDevicesInput = z.strictObject({ expectedContext: directDeviceContext });
export type ListDirectDevicesInput = z.infer<typeof listDirectDevicesInput>;
export const listDirectDevicesOutput = z.strictObject({
  devices: z.array(directDeviceBindingSummary),
});
export type ListDirectDevicesOutput = z.infer<typeof listDirectDevicesOutput>;

const legacyRegisterDirectDeviceInput = z.strictObject({
  deviceId: z.uuid(),
  family: z.literal("amazfit_helio_strap"),
  expectedContext: directDeviceContext,
});
const modernRegisterDirectDeviceInput = z
  .strictObject({
    deviceId: z.uuid(),
    family: z.enum(DIRECT_DEVICE_FAMILIES),
    modelId: z.string().min(1),
    confirmLegacyIdentity: z.boolean().optional(),
    expectedContext: directDeviceContext,
  })
  .refine(
    ({ family, modelId }) => findDirectDeviceModel({ family, modelId }) !== undefined,
    "Unknown direct-device model pair.",
  );
export const registerDirectDeviceInput = z.union([
  legacyRegisterDirectDeviceInput,
  modernRegisterDirectDeviceInput,
]);
export type RegisterDirectDeviceInput = z.infer<typeof registerDirectDeviceInput>;

export const registerDirectDeviceOutput = registerDeviceOutput;
export type RegisterDirectDeviceOutput = z.infer<typeof registerDirectDeviceOutput>;

const directDeviceRecord = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("steps"),
    externalRecordId: z.string().min(1).max(120),
    sourceApp: z.null(),
    startTime: isoUtc,
    endTime: isoUtc,
    count: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal("steps_interval"),
    externalRecordId: z.string().min(1).max(120),
    sourceApp: z.null(),
    startTime: isoUtc,
    endTime: isoUtc,
    count: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal("sleep_session"),
    externalRecordId: z.string().min(1).max(120),
    sourceApp: z.null(),
    startTime: isoUtc,
    endTime: isoUtc,
    stages: z
      .array(
        z.strictObject({
          stage: z.enum(["awake", "light", "deep", "rem"]),
          startTime: isoUtc,
          endTime: isoUtc,
        }),
      )
      .max(200)
      .optional(),
  }),
  z.strictObject({
    type: z.literal("heart_rate"),
    externalRecordId: z.string().min(1).max(120),
    sourceApp: z.null(),
    startTime: isoUtc,
    endTime: isoUtc,
    samples: z
      .array(z.strictObject({ time: isoUtc, bpm: z.number().positive() }))
      .min(1)
      .max(5000),
  }),
  z.strictObject({
    type: z.literal("body_temperature"),
    externalRecordId: z.string().min(1).max(120),
    sourceApp: z.null(),
    startTime: isoUtc,
    endTime: isoUtc,
    celsius: z.number().positive().min(25).max(45),
  }),
  z.strictObject({
    type: z.literal("blood_pressure"),
    externalRecordId: z.string().min(1).max(120),
    sourceApp: z.null(),
    startTime: isoUtc,
    endTime: isoUtc,
    systolic: z.number().int().min(50).max(300),
    diastolic: z.number().int().min(20).max(200),
    meanArterialPressure: z.number().int().min(20).max(250).optional(),
    pulseRate: z.number().int().min(20).max(250).optional(),
  }),
  z.strictObject({
    /** Nightly RMSSD heart-rate variability (Garmin HRV status, last-night average). */
    type: z.literal("hrv_rmssd"),
    externalRecordId: z.string().min(1).max(120),
    sourceApp: z.null(),
    startTime: isoUtc,
    endTime: isoUtc,
    rmssdMs: z.number().positive().max(500),
  }),
  z.strictObject({
    type: z.literal("resting_heart_rate"),
    externalRecordId: z.string().min(1).max(120),
    sourceApp: z.null(),
    startTime: isoUtc,
    endTime: isoUtc,
    bpm: z.number().int().min(20).max(250),
    /**
     * One record per UTC day; the watch's latest sample time. A later
     * revision of the same day supersedes the earlier one.
     */
    lastModifiedAt: isoUtc.optional(),
  }),
  z.strictObject({
    type: z.literal("oxygen_saturation"),
    externalRecordId: z.string().min(1).max(120),
    sourceApp: z.null(),
    startTime: isoUtc,
    endTime: isoUtc,
    samples: z
      .array(z.strictObject({ time: isoUtc, percent: z.number().int().min(50).max(100) }))
      .min(1)
      .max(5000),
  }),
  z.strictObject({
    type: z.literal("respiratory_rate"),
    externalRecordId: z.string().min(1).max(120),
    sourceApp: z.null(),
    startTime: isoUtc,
    endTime: isoUtc,
    samples: z
      .array(z.strictObject({ time: isoUtc, breathsPerMinute: z.number().positive().max(80) }))
      .min(1)
      .max(5000),
  }),
  z.strictObject({
    type: z.literal("workout"),
    externalRecordId: z.string().min(1).max(120),
    sourceApp: z.null(),
    startTime: isoUtc,
    endTime: isoUtc,
    /** Lowercase activity name, e.g. the FIT sport `running`. */
    activity: z.string().min(1).max(64),
    title: z.string().max(200).nullable(),
  }),
  z.strictObject({
    type: z.literal("weight_measurement"),
    externalRecordId: z.string().min(1).max(120),
    sourceApp: z.null(),
    startTime: isoUtc,
    weightKg: z.number().positive().min(2).max(500),
    /** Bio-impedance in ohms; matches the body-composition calculator's range. */
    impedanceOhm: z.number().positive().min(200).max(1200).optional(),
  }),
]);

export const directDeviceBatch = z
  .strictObject({
    schemaVersion: z.literal(1),
    deviceId: z.uuid(),
    deviceIdentity: directDeviceIdentity.optional(),
    provider: z.literal(DIRECT_DEVICE_PROVIDER),
    recordType: z.enum([
      "steps",
      "steps_interval",
      "sleep_session",
      "heart_rate",
      "body_temperature",
      "blood_pressure",
      "weight_measurement",
      "hrv_rmssd",
      "resting_heart_rate",
      "workout",
      "oxygen_saturation",
      "respiratory_rate",
    ]),
    mode: z.literal("backfill"),
    window: z.strictObject({ from: isoUtc, to: isoUtc }).optional(),
    upserts: z.array(directDeviceRecord).min(1).max(1000),
    deletions: z.tuple([]),
    clientTimezone: z.string().min(1).max(64),
  })
  .superRefine((batch, ctx) => {
    batch.upserts.forEach((record, index) => {
      if (record.type !== batch.recordType)
        ctx.addIssue({
          code: "custom",
          path: ["upserts", index, "type"],
          message: "Every upsert must match the batch recordType.",
        });
      if (
        record.type !== "weight_measurement" &&
        new Date(record.endTime).getTime() <= new Date(record.startTime).getTime()
      )
        ctx.addIssue({
          code: "custom",
          path: ["upserts", index, "endTime"],
          message: "endTime must be after startTime.",
        });
      if (record.type === "steps") {
        const start = new Date(record.startTime).getTime();
        const end = new Date(record.endTime).getTime();
        if (end - start !== 60_000 || start % 60_000 !== 0)
          ctx.addIssue({
            code: "custom",
            path: ["upserts", index, "endTime"],
            message: "Steps records must cover one exact UTC minute.",
          });
      }
      if (record.type === "steps_interval") {
        const start = new Date(record.startTime).getTime();
        const end = new Date(record.endTime).getTime();
        // Rings report arbitrary buckets (typically 15 minutes); anything
        // longer than an hour is not a plausible device interval.
        if (end - start > 3_600_000)
          ctx.addIssue({
            code: "custom",
            path: ["upserts", index, "endTime"],
            message: "Steps interval records must cover at most one hour.",
          });
      }
      if (record.type === "sleep_session" && record.stages) {
        let previousEnd: number | undefined;
        record.stages.forEach((stage, stageIndex) => {
          const stageStart = new Date(stage.startTime).getTime();
          const stageEnd = new Date(stage.endTime).getTime();
          if (stageEnd <= stageStart)
            ctx.addIssue({
              code: "custom",
              path: ["upserts", index, "stages", stageIndex, "endTime"],
              message: "Stage endTime must be after startTime.",
            });
          if (previousEnd !== undefined && stageStart < previousEnd)
            ctx.addIssue({
              code: "custom",
              path: ["upserts", index, "stages", stageIndex, "startTime"],
              message: "Sleep stages must be ordered and must not overlap.",
            });
          previousEnd = stageEnd;
        });
      }
      if (
        record.type === "heart_rate" ||
        record.type === "oxygen_saturation" ||
        record.type === "respiratory_rate"
      )
        record.samples.forEach((sample, sampleIndex) => {
          const time = new Date(sample.time).getTime();
          if (
            time < new Date(record.startTime).getTime() ||
            time > new Date(record.endTime).getTime()
          )
            ctx.addIssue({
              code: "custom",
              path: ["upserts", index, "samples", sampleIndex, "time"],
              message: "Sample must be contained in the record interval.",
            });
        });
      if (record.type === "blood_pressure" && record.diastolic >= record.systolic)
        ctx.addIssue({
          code: "custom",
          path: ["upserts", index, "diastolic"],
          message: "diastolic must be lower than systolic.",
        });
    });
    if (
      batch.window &&
      new Date(batch.window.to).getTime() <= new Date(batch.window.from).getTime()
    )
      ctx.addIssue({
        code: "custom",
        path: ["window", "to"],
        message: "window.to must be after window.from.",
      });
  });
export type DirectDeviceBatch = z.infer<typeof directDeviceBatch>;

export const ingestDirectDeviceBatchInput = z.strictObject({
  expectedContext: directDeviceContext,
  batch: directDeviceBatch,
});
export type IngestDirectDeviceBatchInput = z.infer<typeof ingestDirectDeviceBatchInput>;

export const ingestDirectDeviceBatchOutput = ingestBatchOutput;
export type IngestDirectDeviceBatchOutput = z.infer<typeof ingestDirectDeviceBatchOutput>;
