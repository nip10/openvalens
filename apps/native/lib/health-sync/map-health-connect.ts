import {
  mobileHealthRecord,
  type MOBILE_RECORD_TYPES,
  type MobileHealthRecordInput,
} from "@openhealth/api/contracts/mobile-ingest";

/**
 * Health Connect records → the `mobile.ingestBatch` contract.
 *
 * Pure: no React Native imports, so it runs under `bun test`. The device
 * adapter passes the library's exercise-type table in.
 */
export type MobileRecordType = (typeof MOBILE_RECORD_TYPES)[number];

/** Structural subset of the `react-native-health-connect` record results we read. */
export type HealthConnectRecordLike = {
  metadata?: {
    id?: string;
    dataOrigin?: string;
    lastModifiedTime?: string;
    device?: { type?: number; model?: string };
  };
  time?: string;
  startTime?: string;
  endTime?: string;
  weight?: { inKilograms: number };
  percentage?: number;
  count?: number;
  energy?: { inKilocalories: number };
  distance?: { inMeters: number };
  samples?: { time: string; beatsPerMinute: number }[];
  stages?: { stage: number; startTime: string; endTime: string }[];
  exerciseType?: number;
  title?: string;
};

export type MapOptions = {
  /** This app's package name: records it wrote are not re-imported. */
  ownPackage: string;
  /** `ExerciseType` value → constant name, e.g. `56 → "RUNNING"`. */
  exerciseTypeNames: Record<number, string>;
};

// androidx.health.connect.client.records.metadata.Device
const DEVICE_TYPES: Record<number, string> = {
  0: "unknown",
  1: "watch",
  2: "phone",
  3: "scale",
  4: "ring",
  5: "head_mounted",
  6: "fitness_band",
  7: "chest_strap",
  8: "smart_display",
};

// SleepSessionRecord.STAGE_TYPE_*
const SLEEP_STAGES: Record<number, MobileSleepStage> = {
  0: "unknown",
  1: "awake",
  2: "asleep",
  3: "out_of_bed",
  4: "light",
  5: "deep",
  6: "rem",
  7: "awake",
};
type MobileSleepStage = "awake" | "light" | "deep" | "rem" | "asleep" | "out_of_bed" | "unknown";

/** Normalizes any ISO timestamp to `YYYY-MM-DDTHH:MM:SS.sssZ`; invalid → null. */
function utc(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Returns the contract record, or null for own writes and anything the server would reject. */
export function mapHealthConnectRecord(
  recordType: MobileRecordType,
  record: HealthConnectRecordLike,
  options: MapOptions,
): MobileHealthRecordInput | null {
  const metadata = record.metadata ?? {};
  if (metadata.dataOrigin === options.ownPackage) return null;
  const deviceType = metadata.device?.type;
  const lastModifiedAt = utc(metadata.lastModifiedTime);
  const base = {
    externalRecordId: metadata.id ?? "",
    ...(lastModifiedAt ? { lastModifiedAt } : {}),
    sourceApp: metadata.dataOrigin ?? null,
    ...(metadata.device && (deviceType !== undefined || metadata.device.model)
      ? {
          sourceDevice: {
            ...(deviceType !== undefined ? { type: DEVICE_TYPES[deviceType] ?? "unknown" } : {}),
            ...(metadata.device.model ? { model: metadata.device.model } : {}),
          },
        }
      : {}),
  };
  const interval = { startTime: utc(record.startTime), endTime: utc(record.endTime) };

  let candidate: unknown;
  switch (recordType) {
    case "weight":
      candidate = {
        ...base,
        type: "weight",
        startTime: utc(record.time),
        valueKg: record.weight?.inKilograms,
      };
      break;
    case "body_fat":
      candidate = {
        ...base,
        type: "body_fat",
        startTime: utc(record.time),
        percent: record.percentage,
      };
      break;
    case "steps":
      candidate = { ...base, ...interval, type: "steps", count: record.count };
      break;
    case "active_calories":
      candidate = {
        ...base,
        ...interval,
        type: "active_calories",
        kcal: record.energy?.inKilocalories,
      };
      break;
    case "distance":
      candidate = { ...base, ...interval, type: "distance", meters: record.distance?.inMeters };
      break;
    case "heart_rate":
      candidate = {
        ...base,
        ...interval,
        type: "heart_rate",
        samples: (record.samples ?? []).map((sample) => ({
          time: utc(sample.time),
          bpm: sample.beatsPerMinute,
        })),
      };
      break;
    case "sleep_session":
      candidate = {
        ...base,
        ...interval,
        type: "sleep_session",
        ...(record.stages
          ? {
              stages: record.stages.map((stage) => ({
                stage: SLEEP_STAGES[stage.stage] ?? "unknown",
                startTime: utc(stage.startTime),
                endTime: utc(stage.endTime),
              })),
            }
          : {}),
      };
      break;
    case "workout": {
      const name =
        record.exerciseType === undefined
          ? undefined
          : options.exerciseTypeNames[record.exerciseType];
      candidate = {
        ...base,
        ...interval,
        type: "workout",
        activity: name ? name.toLowerCase() : `exercise_type_${record.exerciseType ?? "unknown"}`,
        title: record.title ?? null,
      };
      break;
    }
  }
  const parsed = mobileHealthRecord.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
