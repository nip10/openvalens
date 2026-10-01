/**
 * Per-source Health Connect readers.
 *
 * Android — implemented against `react-native-health-connect` (dynamic import
 * so the native module never evaluates on iOS).
 * iOS     — TODO: HealthKit not yet wired. Every reader throws a clear error
 *           when called off Android; the platform dispatch lives in
 *           `./permissions.ts` + `./scheduler.ts` for now.
 */
import { Platform } from "react-native";
import type { RecordResult, RecordType } from "react-native-health-connect";

import type {
  ActiveCaloriesRecord,
  BodyFatRecord,
  DistanceRecord,
  HealthRecords,
  HeartRateRecord,
  SleepRecord,
  StepsRecord,
  WeightRecord,
  WorkoutRecord,
} from "./types";

export type DateInput = Date | string;

function toIso(value: DateInput): string {
  return value instanceof Date ? value.toISOString() : value;
}

function assertAndroid(feature: string): void {
  if (Platform.OS !== "android") {
    throw new Error(
      `TODO: HealthKit not yet wired. "${feature}" currently supports Android (Health Connect) only.`,
    );
  }
}

interface SourceMetadata {
  id?: string;
  dataOrigin?: string;
}

function metadataFields(metadata: SourceMetadata | undefined): {
  externalRecordId?: string;
  sourceApp?: string;
} {
  return {
    ...(metadata?.id ? { externalRecordId: metadata.id } : {}),
    ...(metadata?.dataOrigin ? { sourceApp: metadata.dataOrigin } : {}),
  };
}

/** Reads every page for a record type within `[from, to]`. */
async function readAllPages<T extends RecordType>(
  recordType: T,
  from: DateInput,
  to: DateInput,
): Promise<RecordResult<T>[]> {
  const healthConnect = await import("react-native-health-connect");
  const results: RecordResult<T>[] = [];
  let pageToken: string | undefined;

  do {
    const page = await healthConnect.readRecords(recordType, {
      timeRangeFilter: {
        operator: "between",
        startTime: toIso(from),
        endTime: toIso(to),
      },
      ascendingOrder: true,
      ...(pageToken ? { pageToken } : {}),
    });
    results.push(...page.records);
    pageToken = page.pageToken;
  } while (pageToken);

  return results;
}

/** Whether the Health Connect SDK is present + available on this device. */
export async function isHealthConnectAvailable(): Promise<boolean> {
  if (Platform.OS !== "android") {
    return false;
  }
  const healthConnect = await import("react-native-health-connect");
  const sdkStatus = await healthConnect.getSdkStatus();
  return sdkStatus === healthConnect.SdkAvailabilityStatus.SDK_AVAILABLE;
}

export async function readSteps(from: DateInput, to: DateInput): Promise<StepsRecord[]> {
  assertAndroid("readSteps");
  const rows = await readAllPages("Steps", from, to);
  return rows.map((row) => ({
    ...metadataFields(row.metadata),
    startTime: row.startTime,
    endTime: row.endTime,
    count: row.count,
  }));
}

export async function readHeartRate(from: DateInput, to: DateInput): Promise<HeartRateRecord[]> {
  assertAndroid("readHeartRate");
  const rows = await readAllPages("HeartRate", from, to);
  return rows.map((row) => {
    const samples = row.samples.map((sample) => ({
      time: sample.time,
      beatsPerMinute: sample.beatsPerMinute,
    }));
    const avgBpm =
      samples.length === 0
        ? 0
        : samples.reduce((total, sample) => total + sample.beatsPerMinute, 0) / samples.length;

    return {
      ...metadataFields(row.metadata),
      startTime: row.startTime,
      endTime: row.endTime,
      sampleCount: samples.length,
      avgBpm,
      samples,
    };
  });
}

export async function readSleep(from: DateInput, to: DateInput): Promise<SleepRecord[]> {
  assertAndroid("readSleep");
  const rows = await readAllPages("SleepSession", from, to);
  return rows.map((row) => ({
    ...metadataFields(row.metadata),
    startTime: row.startTime,
    endTime: row.endTime,
    ...(row.stages
      ? {
          stages: row.stages.map((stage) => ({
            startTime: stage.startTime,
            endTime: stage.endTime,
            stage: stage.stage,
          })),
        }
      : {}),
  }));
}

export async function readWeight(from: DateInput, to: DateInput): Promise<WeightRecord[]> {
  assertAndroid("readWeight");
  const rows = await readAllPages("Weight", from, to);
  return rows.map((row) => ({
    ...metadataFields(row.metadata),
    time: row.time,
    weightKg: row.weight.inKilograms,
    // Body fat is a separate Health Connect record type; joined server-side.
    bodyFatPct: null,
  }));
}

export async function readBodyFat(from: DateInput, to: DateInput): Promise<BodyFatRecord[]> {
  assertAndroid("readBodyFat");
  const rows = await readAllPages("BodyFat", from, to);
  return rows.map((row) => ({
    ...metadataFields(row.metadata),
    time: row.time,
    bodyFatPct: row.percentage,
  }));
}

export async function readActiveCalories(
  from: DateInput,
  to: DateInput,
): Promise<ActiveCaloriesRecord[]> {
  assertAndroid("readActiveCalories");
  const rows = await readAllPages("ActiveCaloriesBurned", from, to);
  return rows.map((row) => ({
    ...metadataFields(row.metadata),
    startTime: row.startTime,
    endTime: row.endTime,
    kilocalories: row.energy.inKilocalories,
  }));
}

export async function readDistance(from: DateInput, to: DateInput): Promise<DistanceRecord[]> {
  assertAndroid("readDistance");
  const rows = await readAllPages("Distance", from, to);
  return rows.map((row) => ({
    ...metadataFields(row.metadata),
    startTime: row.startTime,
    endTime: row.endTime,
    meters: row.distance.inMeters,
  }));
}

export async function readWorkouts(from: DateInput, to: DateInput): Promise<WorkoutRecord[]> {
  assertAndroid("readWorkouts");
  const rows = await readAllPages("ExerciseSession", from, to);
  return rows.map((row) => ({
    ...metadataFields(row.metadata),
    startTime: row.startTime,
    endTime: row.endTime,
    type: row.exerciseType,
    durationSeconds: Math.max(
      0,
      Math.round((Date.parse(row.endTime) - Date.parse(row.startTime)) / 1000),
    ),
    notes: row.notes ?? null,
  }));
}

/**
 * Reads every source for a window. Individual sources that fail (e.g. the
 * user denied that scope) are logged and returned empty rather than failing
 * the whole batch — background sync must be resilient to partial grants.
 */
export async function readAllSources(from: DateInput, to: DateInput): Promise<HealthRecords> {
  assertAndroid("readAllSources");

  async function readOrEmpty<T>(source: string, reader: () => Promise<T[]>): Promise<T[]> {
    try {
      return await reader();
    } catch (error) {
      console.warn(`[health-connect] failed to read ${source}`, error);
      return [];
    }
  }

  const [steps, heartRate, sleep, weight, bodyFat, activeCalories, distance, workouts] =
    await Promise.all([
      readOrEmpty("steps", () => readSteps(from, to)),
      readOrEmpty("heartRate", () => readHeartRate(from, to)),
      readOrEmpty("sleep", () => readSleep(from, to)),
      readOrEmpty("weight", () => readWeight(from, to)),
      readOrEmpty("bodyFat", () => readBodyFat(from, to)),
      readOrEmpty("activeCalories", () => readActiveCalories(from, to)),
      readOrEmpty("distance", () => readDistance(from, to)),
      readOrEmpty("workouts", () => readWorkouts(from, to)),
    ]);

  return { steps, heartRate, sleep, weight, bodyFat, activeCalories, distance, workouts };
}
