import type { MobileHealthRecordInput } from "@openvalens/api/contracts/mobile-ingest";
import Constants from "expo-constants";

import type { ChangesPage, HealthSource } from "./drain";
import {
  mapHealthKitSample,
  type HealthKitMapOptions,
  type HealthKitRecordType,
  type HealthKitSampleLike,
} from "./map-healthkit";
import {
  HEALTHKIT_QUANTITY_TYPES,
  HEALTHKIT_SLEEP_TYPE,
  HEALTHKIT_TYPE_IDENTIFIERS,
  HEALTHKIT_WORKOUT_TYPE,
} from "./healthkit-types";

export { HEALTHKIT_QUANTITY_TYPES, HEALTHKIT_SLEEP_TYPE, HEALTHKIT_WORKOUT_TYPE };

/**
 * iOS `HealthSource` on `@kingstinct/react-native-healthkit` anchored queries
 * (#26). Imported dynamically so the native module never loads on Android.
 *
 * The cursor token wraps a HealthKit anchor. Starting without an anchor
 * walks the full history in pages, then keeps returning only changes and
 * deletions, so there is no separate backfill (`backfill: false`).
 */
/** The types every install was first asked for (#26). */
const HEALTHKIT_BASE_TYPES: HealthKitRecordType[] = [
  ...(Object.keys(HEALTHKIT_QUANTITY_TYPES) as (keyof typeof HEALTHKIT_QUANTITY_TYPES)[]),
  "workout",
];
const HEALTHKIT_BASE_READ_TYPES = [
  ...Object.values(HEALTHKIT_QUANTITY_TYPES).map((entry) => entry.identifier),
  HEALTHKIT_WORKOUT_TYPE,
];

/**
 * Sleep (#131) is read as raw stage segments (`sleep_segment`); the server
 * groups them into sessions, so a deleted segment (a bare UUID) is always
 * resolvable and the device keeps no sleep data.
 */
export const HEALTHKIT_SYNCED_TYPES: HealthKitRecordType[] = [
  ...HEALTHKIT_BASE_TYPES,
  "sleep_segment",
];
export const HEALTHKIT_READ_TYPES = [...HEALTHKIT_BASE_READ_TYPES, HEALTHKIT_SLEEP_TYPE];

/**
 * Types the user has been asked for, checked one type at a time: installs
 * that connected before sleep was added keep syncing everything else until
 * they reconnect from Settings, and a person who only turned some modules on
 * (onboarding stage 1) was only asked for those modules' types.
 */
export async function healthKitAskedTypes(): Promise<HealthKitRecordType[]> {
  const { getRequestStatusForAuthorization, AuthorizationRequestStatus } =
    await import("@kingstinct/react-native-healthkit");
  const asked = await Promise.all(
    HEALTHKIT_SYNCED_TYPES.map(
      async (type) =>
        (await getRequestStatusForAuthorization({
          toRead: [HEALTHKIT_TYPE_IDENTIFIERS[type]],
        })) === AuthorizationRequestStatus.unnecessary,
    ),
  );
  return HEALTHKIT_SYNCED_TYPES.filter((_, index) => asked[index]);
}

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
    return healthKitAskedTypes();
  },

  async captureToken() {
    return JSON.stringify({} satisfies Token);
  },

  async readWindow() {
    return [];
  },

  async getChanges(type, token): Promise<ChangesPage> {
    // Whole sessions are Health Connect's shape; iOS sends `sleep_segment`.
    if (type === "sleep_session")
      return { upserts: [], deletions: [], nextToken: token, hasMore: false, expired: false };
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
    } else if (type === "sleep_segment") {
      const result = await hk.queryCategorySamplesWithAnchor(HEALTHKIT_SLEEP_TYPE, query);
      samples = result.samples as unknown as HealthKitSampleLike[];
      deleted = result.deletedSamples;
      newAnchor = result.newAnchor;
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
