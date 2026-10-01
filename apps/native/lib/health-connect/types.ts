/**
 * Wire-format record types for the mobile Health Connect ingestion layer.
 *
 * These mirror the bucket shape produced by the OLD Kotlin companion
 * (`RecordsBucket` / `SyncRecords` in surgeonfish@1493427) extended with
 * the extra read scopes enumerated in `./permissions.ts` (body fat, active
 * calories, distance).
 *
 * IMPORTANT: `@openhealth/api` does NOT expose a mobile sync-session
 * contract yet (there is no `packages/api/src/contracts` tree, and the
 * routers do not mount `/sync-sessions`). Until that lands, this file is the
 * client-side source of truth and `./sync.ts` talks to a placeholder REST
 * surface. See the TODOs there.
 */

export interface HealthRecordBase {
  /** Health Connect / HealthKit record UUID when the source provides one. */
  externalRecordId?: string;
  /** Originating app bundle / package name. */
  sourceApp?: string;
}

export interface StepsRecord extends HealthRecordBase {
  startTime: string;
  endTime: string;
  count: number;
}

export interface HeartRateSampleRecord {
  time: string;
  beatsPerMinute: number;
}

export interface HeartRateRecord extends HealthRecordBase {
  startTime: string;
  endTime: string;
  sampleCount: number;
  avgBpm: number;
  samples: HeartRateSampleRecord[];
}

export interface SleepStageRecord {
  startTime: string;
  endTime: string;
  /** Health Connect `SleepStageType` numeric code. */
  stage: number;
}

export interface SleepRecord extends HealthRecordBase {
  startTime: string;
  endTime: string;
  stages?: SleepStageRecord[];
}

export interface WeightRecord extends HealthRecordBase {
  time: string;
  weightKg: number;
  bodyFatPct: number | null;
}

export interface BodyFatRecord extends HealthRecordBase {
  time: string;
  bodyFatPct: number;
}

export interface ActiveCaloriesRecord extends HealthRecordBase {
  startTime: string;
  endTime: string;
  kilocalories: number;
}

export interface DistanceRecord extends HealthRecordBase {
  startTime: string;
  endTime: string;
  meters: number;
}

export interface WorkoutRecord extends HealthRecordBase {
  startTime: string;
  endTime: string;
  /** Health Connect `ExerciseType` numeric code. */
  type: number;
  durationSeconds: number;
  notes: string | null;
}

/**
 * The full set of records uploaded in one sync batch, keyed by bucket. This
 * matches the `records` object in the OLD Kotlin `SyncPayload`.
 */
export interface HealthRecords {
  steps: StepsRecord[];
  heartRate: HeartRateRecord[];
  sleep: SleepRecord[];
  weight: WeightRecord[];
  bodyFat: BodyFatRecord[];
  activeCalories: ActiveCaloriesRecord[];
  distance: DistanceRecord[];
  workouts: WorkoutRecord[];
}

export interface HealthPayloadMetadata {
  payloadVersion: string;
  deviceId: string;
  timezone: string;
  windowStart: string;
  windowEnd: string;
}

export interface HealthPayload {
  metadata?: Partial<HealthPayloadMetadata>;
  records: HealthRecords;
}

export type HealthRecordBucket = keyof HealthRecords;

/** Fresh empty buckets — never share mutable arrays between callers. */
export function emptyHealthRecords(): HealthRecords {
  return {
    steps: [],
    heartRate: [],
    sleep: [],
    weight: [],
    bodyFat: [],
    activeCalories: [],
    distance: [],
    workouts: [],
  };
}

/** Count of every record across all buckets. */
export function countHealthRecords(records: HealthRecords): number {
  return Object.values(records).reduce((total, bucket) => total + bucket.length, 0);
}
