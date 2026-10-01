import type { RecordType } from "react-native-health-connect";

import type { MobileRecordType } from "./map-health-connect";

/** Contract record type ↔ Health Connect record type. One cursor per type. */
export const HEALTH_CONNECT_RECORD_TYPES = {
  weight: "Weight",
  body_fat: "BodyFat",
  steps: "Steps",
  heart_rate: "HeartRate",
  active_calories: "ActiveCaloriesBurned",
  distance: "Distance",
  sleep_session: "SleepSession",
  workout: "ExerciseSession",
} as const satisfies Record<MobileRecordType, RecordType>;

export const SYNCED_TYPES = Object.keys(HEALTH_CONNECT_RECORD_TYPES) as MobileRecordType[];
