import { z } from "zod";

import { ingestBatchOutput, isoUtc, registerDeviceOutput } from "./mobile-ingest";

export const DIRECT_DEVICE_PROVIDER = "direct_device" as const;
export const DIRECT_DEVICE_FAMILY = "amazfit_helio_strap" as const;

/** Safe, stable refusal categories for clients; deliberately excludes identity details. */
export const directDeviceRefusalReason = z.enum(["REVOKED", "UNAVAILABLE"]);
export type DirectDeviceRefusalReason = z.infer<typeof directDeviceRefusalReason>;

export const directDeviceContext = z.strictObject({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
});
export type DirectDeviceContext = z.infer<typeof directDeviceContext>;

export const registerDirectDeviceInput = z.strictObject({
  deviceId: z.uuid(),
  family: z.literal(DIRECT_DEVICE_FAMILY),
  expectedContext: directDeviceContext,
});
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
    type: z.literal("heart_rate"),
    externalRecordId: z.string().min(1).max(120),
    sourceApp: z.null(),
    startTime: isoUtc,
    endTime: isoUtc,
    samples: z.array(z.strictObject({ time: isoUtc, bpm: z.number().positive() })).min(1).max(5000),
  }),
]);

export const directDeviceBatch = z
  .strictObject({
    schemaVersion: z.literal(1),
    deviceId: z.uuid(),
    provider: z.literal(DIRECT_DEVICE_PROVIDER),
    recordType: z.enum(["steps", "heart_rate"]),
    mode: z.literal("backfill"),
    window: z.strictObject({ from: isoUtc, to: isoUtc }).optional(),
    upserts: z.array(directDeviceRecord).min(1).max(1000),
    deletions: z.tuple([]),
    clientTimezone: z.string().min(1).max(64),
  })
  .superRefine((batch, ctx) => {
    batch.upserts.forEach((record, index) => {
      if (record.type !== batch.recordType)
        ctx.addIssue({ code: "custom", path: ["upserts", index, "type"], message: "Every upsert must match the batch recordType." });
      if (new Date(record.endTime).getTime() <= new Date(record.startTime).getTime())
        ctx.addIssue({ code: "custom", path: ["upserts", index, "endTime"], message: "endTime must be after startTime." });
      if (record.type === "heart_rate")
        record.samples.forEach((sample, sampleIndex) => {
          const time = new Date(sample.time).getTime();
          if (time < new Date(record.startTime).getTime() || time > new Date(record.endTime).getTime())
            ctx.addIssue({ code: "custom", path: ["upserts", index, "samples", sampleIndex, "time"], message: "Sample must be contained in the record interval." });
        });
    });
    if (batch.window && new Date(batch.window.to).getTime() <= new Date(batch.window.from).getTime())
      ctx.addIssue({ code: "custom", path: ["window", "to"], message: "window.to must be after window.from." });
  });
export type DirectDeviceBatch = z.infer<typeof directDeviceBatch>;

export const ingestDirectDeviceBatchInput = z.strictObject({
  expectedContext: directDeviceContext,
  batch: directDeviceBatch,
});
export type IngestDirectDeviceBatchInput = z.infer<typeof ingestDirectDeviceBatchInput>;

export const ingestDirectDeviceBatchOutput = ingestBatchOutput;
export type IngestDirectDeviceBatchOutput = z.infer<typeof ingestDirectDeviceBatchOutput>;
