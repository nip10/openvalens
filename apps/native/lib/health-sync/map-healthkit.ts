import {
  mobileHealthRecord,
  type HEALTHKIT_SLEEP_VALUES,
  type MobileHealthRecordInput,
} from "@openvalens/api/contracts/mobile-ingest";

import type { MobileRecordType } from "./map-health-connect";

/**
 * HealthKit samples → the `mobile.ingestBatch` contract (#26). Pure, so it
 * runs under `bun test`. HealthKit samples are immutable (an edit is a delete
 * plus a new UUID), so there is no `lastModifiedAt`.
 */
export type HealthKitRecordType = Exclude<MobileRecordType, "sleep_session">;

/** Structural subset of `@kingstinct/react-native-healthkit` samples (plain JSON). */
export type HealthKitSampleLike = {
  uuid: string;
  startDate: Date | string;
  endDate: Date | string;
  quantity?: number;
  /** Category samples: `HKCategoryValueSleepAnalysis` for sleep. */
  value?: number;
  metadata?: { HKTimeZone?: unknown };
  workoutActivityType?: number;
  sourceRevision?: { source?: { bundleIdentifier?: string } };
  device?: { model?: string };
};

export type HealthKitMapOptions = {
  /** This app's bundle id: samples it wrote are not re-imported. */
  ownBundleId: string;
  /** `WorkoutActivityType` value → enum name, e.g. `37 → "running"`. */
  workoutActivityNames: Record<number, string>;
};

function utc(value: Date | string): string | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function deviceType(model: string | undefined): string | undefined {
  if (!model) return undefined;
  if (/watch/i.test(model)) return "watch";
  if (/iphone/i.test(model)) return "phone";
  return undefined;
}

/**
 * `HKCategoryValueSleepAnalysis` raw value → contract value: inBed 0,
 * asleepUnspecified 1, awake 2, asleepCore 3, asleepDeep 4, asleepREM 5.
 * Values a newer iOS adds are skipped rather than guessed.
 */
export const HEALTHKIT_SLEEP_VALUE_BY_RAW: Record<number, (typeof HEALTHKIT_SLEEP_VALUES)[number]> =
  {
    0: "in_bed",
    1: "asleep_unspecified",
    2: "awake",
    3: "asleep_core",
    4: "asleep_deep",
    5: "asleep_rem",
  };

const snakeCase = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

export function mapHealthKitSample(
  recordType: HealthKitRecordType,
  sample: HealthKitSampleLike,
  options: HealthKitMapOptions,
): MobileHealthRecordInput | null {
  const bundleId = sample.sourceRevision?.source?.bundleIdentifier;
  if (bundleId === options.ownBundleId) return null;
  const model = sample.device?.model;
  const type = deviceType(model);
  const base = {
    externalRecordId: sample.uuid,
    sourceApp: bundleId ?? null,
    ...(model ? { sourceDevice: { ...(type ? { type } : {}), model } } : {}),
  };
  const startTime = utc(sample.startDate);
  const interval = { startTime, endTime: utc(sample.endDate) };
  const q = sample.quantity;

  let candidate: unknown;
  switch (recordType) {
    case "weight":
      candidate = { ...base, type: "weight", startTime, valueKg: q };
      break;
    case "body_fat":
      // HealthKit percent quantities are fractions: 0.182 means 18.2 %.
      candidate = {
        ...base,
        type: "body_fat",
        startTime,
        percent: q === undefined ? undefined : Math.round(q * 1000) / 10,
      };
      break;
    case "steps":
      candidate = { ...base, ...interval, type: "steps", count: q };
      break;
    case "active_calories":
      candidate = { ...base, ...interval, type: "active_calories", kcal: q };
      break;
    case "distance":
      candidate = { ...base, ...interval, type: "distance", meters: q };
      break;
    case "heart_rate":
      candidate = {
        ...base,
        ...interval,
        type: "heart_rate",
        samples: [{ time: startTime, bpm: q }],
      };
      break;
    case "sleep_segment": {
      // Sessions are grouped on the server, which also resolves deletions (#131).
      const timeZone = sample.metadata?.HKTimeZone;
      candidate = {
        ...base,
        ...interval,
        type: "sleep_segment",
        value: sample.value === undefined ? undefined : HEALTHKIT_SLEEP_VALUE_BY_RAW[sample.value],
        ...(typeof timeZone === "string" && timeZone ? { timeZone } : {}),
      };
      break;
    }
    case "workout": {
      const value = sample.workoutActivityType;
      const name = value === undefined ? undefined : options.workoutActivityNames[value];
      candidate = {
        ...base,
        ...interval,
        type: "workout",
        activity: name ? snakeCase(name) : `workout_activity_type_${value ?? "unknown"}`,
        title: null,
      };
      break;
    }
  }
  const parsed = mobileHealthRecord.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
