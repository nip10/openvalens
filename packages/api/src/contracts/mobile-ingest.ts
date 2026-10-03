import { z } from "zod";

/**
 * `mobile.*` wire contract (issue #7, docs/architecture/mobile-sync-decision.md).
 *
 * Shared by the server router and `apps/native`, so this file imports only
 * `zod`: nothing server-side may leak into the app bundle. The server checks
 * these types against `@openvalens/ingestion`'s `MobileIngestBatch`.
 *
 * Schemas are strict: unknown keys (including any `organizationId` or
 * `userId`) are rejected. The organization always comes from the session.
 */

/** Same rule as `isCanonicalUtcTimestamp` in `@openvalens/ingestion`. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const isoUtc = z
  .string()
  .regex(ISO_UTC, "Expected a UTC timestamp like 2026-10-01T07:00:00.000Z")
  .refine((value) => !Number.isNaN(new Date(value).getTime()), "Invalid timestamp");

export const MOBILE_RECORD_TYPES = [
  "weight",
  "body_fat",
  "steps",
  "heart_rate",
  "active_calories",
  "distance",
  "sleep_session",
  "workout",
] as const;

export const MOBILE_PROVIDERS = ["health_connect", "apple_health"] as const;

const base = {
  /** Health Connect `metadata.id` or HealthKit sample UUID. */
  externalRecordId: z.string().min(1).max(200),
  /** Health Connect `metadata.lastModifiedTime`; a new value stores a new version. */
  lastModifiedAt: isoUtc.optional(),
  /** Health Connect `dataOrigin` or HealthKit `sourceRevision.bundleId`. */
  sourceApp: z.string().max(200).nullable(),
  sourceDevice: z
    .strictObject({ type: z.string().max(50).optional(), model: z.string().max(100).optional() })
    .optional(),
};

const interval = { startTime: isoUtc, endTime: isoUtc };

export const mobileHealthRecord = z.discriminatedUnion("type", [
  z.strictObject({
    ...base,
    type: z.literal("weight"),
    startTime: isoUtc,
    valueKg: z.number().positive(),
  }),
  z.strictObject({
    ...base,
    type: z.literal("body_fat"),
    startTime: isoUtc,
    percent: z.number().min(0).max(100),
  }),
  z.strictObject({
    ...base,
    ...interval,
    type: z.literal("steps"),
    count: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ...base,
    ...interval,
    type: z.literal("heart_rate"),
    samples: z
      .array(z.strictObject({ time: isoUtc, bpm: z.number().positive() }))
      .min(1)
      .max(5000),
  }),
  z.strictObject({
    ...base,
    ...interval,
    type: z.literal("active_calories"),
    kcal: z.number().nonnegative(),
  }),
  z.strictObject({
    ...base,
    ...interval,
    type: z.literal("distance"),
    meters: z.number().nonnegative(),
  }),
  z.strictObject({
    ...base,
    ...interval,
    type: z.literal("sleep_session"),
    stages: z
      .array(
        z.strictObject({
          stage: z.enum(["awake", "light", "deep", "rem", "asleep", "out_of_bed", "unknown"]),
          startTime: isoUtc,
          endTime: isoUtc,
        }),
      )
      .max(500)
      .optional(),
  }),
  z.strictObject({
    ...base,
    ...interval,
    type: z.literal("workout"),
    /** Mapped on the device from HC `ExerciseType` / `HKWorkoutActivityType`. */
    activity: z.string().min(1).max(64),
    title: z.string().max(200).nullable(),
  }),
]);

export type MobileHealthRecordInput = z.infer<typeof mobileHealthRecord>;

export const ingestBatchInput = z
  .strictObject({
    schemaVersion: z.literal(1),
    /** From `mobile.registerDevice`; never an org or user id. */
    deviceId: z.uuid(),
    provider: z.enum(MOBILE_PROVIDERS),
    recordType: z.enum(MOBILE_RECORD_TYPES),
    mode: z.enum(["changes", "backfill"]),
    window: z.strictObject({ from: isoUtc, to: isoUtc }).optional(),
    upserts: z.array(mobileHealthRecord).max(1000),
    deletions: z.array(z.strictObject({ externalRecordId: z.string().min(1).max(200) })).max(1000),
    clientTimezone: z.string().min(1).max(64),
  })
  .superRefine((batch, ctx) => {
    if (batch.upserts.length === 0 && batch.deletions.length === 0)
      ctx.addIssue({ code: "custom", message: "A batch needs at least one upsert or deletion." });
    batch.upserts.forEach((record, index) => {
      if (record.type !== batch.recordType)
        ctx.addIssue({
          code: "custom",
          path: ["upserts", index, "type"],
          message: "Every upsert must match the batch recordType.",
        });
    });
    if (batch.window && batch.mode !== "backfill")
      ctx.addIssue({ code: "custom", path: ["window"], message: "window is only for backfill." });
  });

export type IngestBatchInput = z.infer<typeof ingestBatchInput>;

export const ingestBatchOutput = z.object({
  /**
   * `applied`: stored and written. `queued`: stored, written later by the cron.
   * `duplicate`: this exact batch was already accepted. In all three cases the
   * device may advance its cursor.
   */
  status: z.enum(["applied", "queued", "duplicate"]),
  rawArtifactId: z.number(),
  accepted: z.number(),
  duplicates: z.number(),
  rejected: z.number(),
  /** Previously stored rows this batch deleted or replaced with a newer version. */
  superseded: z.number(),
  /** Audit target: the raw artifact id. */
  targetId: z.string(),
});

export const registerDeviceInput = z.strictObject({
  deviceId: z.uuid(),
  platform: z.enum(["android", "ios"]),
  deviceModel: z.string().max(100).optional(),
  appVersion: z.string().max(32),
});

export const registerDeviceOutput = z.object({
  providerConnectionId: z.number(),
  targetId: z.string(),
});

export const syncStatusOutput = z.object({
  devices: z.array(
    z.object({
      deviceId: z.string(),
      provider: z.string(),
      status: z.string(),
      lastIngestAt: z.string().nullable(),
      perType: z.record(
        z.string(),
        z.object({ lastAt: z.string().nullable(), lastStatus: z.string().nullable() }),
      ),
    }),
  ),
});
