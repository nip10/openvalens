import type { MobileHealthRecordInput } from "@openvalens/api/contracts/mobile-ingest";
import Constants from "expo-constants";

import type { ChangesPage, HealthSource } from "./drain";
import {
  mapHealthKitSample,
  type HealthKitMapOptions,
  type HealthKitRecordType,
  type HealthKitSampleLike,
} from "./map-healthkit";

/**
 * iOS `HealthSource` on `@kingstinct/react-native-healthkit` anchored queries
 * (#26). Imported dynamically so the native module never loads on Android.
 *
 * The cursor token wraps a HealthKit anchor. Starting without an anchor
 * walks the full history in pages, then keeps returning only changes and
 * deletions, so there is no separate backfill (`backfill: false`).
 */
export const HEALTHKIT_QUANTITY_TYPES = {
  weight: { identifier: "HKQuantityTypeIdentifierBodyMass", unit: "kg" },
  body_fat: { identifier: "HKQuantityTypeIdentifierBodyFatPercentage", unit: "%" },
  steps: { identifier: "HKQuantityTypeIdentifierStepCount", unit: "count" },
  heart_rate: { identifier: "HKQuantityTypeIdentifierHeartRate", unit: "count/min" },
  active_calories: { identifier: "HKQuantityTypeIdentifierActiveEnergyBurned", unit: "kcal" },
  distance: { identifier: "HKQuantityTypeIdentifierDistanceWalkingRunning", unit: "m" },
} as const;
export const HEALTHKIT_WORKOUT_TYPE = "HKWorkoutTypeIdentifier" as const;

/** Sleep is Android-only for now: HealthKit stores stage segments, not sessions. */
export const HEALTHKIT_SYNCED_TYPES: HealthKitRecordType[] = [
  ...(Object.keys(HEALTHKIT_QUANTITY_TYPES) as (keyof typeof HEALTHKIT_QUANTITY_TYPES)[]),
  "workout",
];

const PAGE_SIZE = 500;

type Token = { anchor?: string };
const parseToken = (token: string): Token => {
  try {
    return JSON.parse(token) as Token;
  } catch {
    return {};
  }
};

let mapOptions: HealthKitMapOptions | null = null;
async function getMapOptions(): Promise<HealthKitMapOptions> {
  if (mapOptions) return mapOptions;
  const { WorkoutActivityType } = await import("@kingstinct/react-native-healthkit");
  const workoutActivityNames: Record<number, string> = {};
  for (const [name, value] of Object.entries(WorkoutActivityType))
    if (typeof value === "number") workoutActivityNames[value] = name;
  mapOptions = {
    ownBundleId: Constants.expoConfig?.ios?.bundleIdentifier ?? "com.openvalens.app",
    workoutActivityNames,
  };
  return mapOptions;
}

function mapAll(
  type: HealthKitRecordType,
  samples: readonly HealthKitSampleLike[],
  options: HealthKitMapOptions,
) {
  const mapped: MobileHealthRecordInput[] = [];
  for (const sample of samples) {
    const record = mapHealthKitSample(type, sample, options);
    if (record) mapped.push(record);
  }
  return mapped;
}

export const healthKitSource: HealthSource = {
  backfill: false,

  async grantedTypes() {
    // HealthKit never reveals whether read access was granted (privacy).
    // Once the user has been asked, query everything; denied types return
    // no samples.
    const { getRequestStatusForAuthorization, AuthorizationRequestStatus } =
      await import("@kingstinct/react-native-healthkit");
    const status = await getRequestStatusForAuthorization({ toRead: HEALTHKIT_READ_TYPES });
    return status === AuthorizationRequestStatus.unnecessary ? HEALTHKIT_SYNCED_TYPES : [];
  },

  async captureToken() {
    return JSON.stringify({} satisfies Token);
  },

  async readWindow() {
    return [];
  },

  async getChanges(type, token): Promise<ChangesPage> {
    const hk = await import("@kingstinct/react-native-healthkit");
    const options = await getMapOptions();
    const { anchor } = parseToken(token);
    const query = { limit: PAGE_SIZE, ...(anchor ? { anchor } : {}) };

    let samples: HealthKitSampleLike[];
    let deleted: readonly { uuid: string }[];
    let newAnchor: string;
    if (type === "workout") {
      const result = await hk.queryWorkoutSamplesWithAnchor(query);
      samples = result.workouts.map((workout) => {
        const json = workout.toJSON() as unknown as HealthKitSampleLike;
        workout.dispose();
        return json;
      });
      deleted = result.deletedSamples;
      newAnchor = result.newAnchor;
    } else if (type === "sleep_session") {
      return { upserts: [], deletions: [], nextToken: token, hasMore: false, expired: false };
    } else {
      const { identifier, unit } = HEALTHKIT_QUANTITY_TYPES[type];
      const result = await hk.queryQuantitySamplesWithAnchor(identifier, { ...query, unit });
      samples = result.samples as unknown as HealthKitSampleLike[];
      deleted = result.deletedSamples;
      newAnchor = result.newAnchor;
    }

    return {
      upserts: mapAll(type, samples, options),
      deletions: deleted.map((sample) => ({ externalRecordId: sample.uuid })),
      nextToken: JSON.stringify({ anchor: newAnchor } satisfies Token),
      hasMore: samples.length + deleted.length >= PAGE_SIZE,
      expired: false,
    };
  },
};

export const HEALTHKIT_READ_TYPES = [
  ...Object.values(HEALTHKIT_QUANTITY_TYPES).map((entry) => entry.identifier),
  HEALTHKIT_WORKOUT_TYPE,
];
