import type { HealthKitRecordType } from "./map-healthkit";

/**
 * HealthKit type identifiers per contract record type. Pure (no native
 * imports) so the module-based permission logic runs under `bun test`.
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
export const HEALTHKIT_SLEEP_TYPE = "HKCategoryTypeIdentifierSleepAnalysis" as const;

export type HealthKitReadIdentifier =
  | (typeof HEALTHKIT_QUANTITY_TYPES)[keyof typeof HEALTHKIT_QUANTITY_TYPES]["identifier"]
  | typeof HEALTHKIT_WORKOUT_TYPE
  | typeof HEALTHKIT_SLEEP_TYPE;

/** The read identifier each synced HealthKit record type needs. */
export const HEALTHKIT_TYPE_IDENTIFIERS: Record<HealthKitRecordType, HealthKitReadIdentifier> = {
  weight: HEALTHKIT_QUANTITY_TYPES.weight.identifier,
  body_fat: HEALTHKIT_QUANTITY_TYPES.body_fat.identifier,
  steps: HEALTHKIT_QUANTITY_TYPES.steps.identifier,
  heart_rate: HEALTHKIT_QUANTITY_TYPES.heart_rate.identifier,
  active_calories: HEALTHKIT_QUANTITY_TYPES.active_calories.identifier,
  distance: HEALTHKIT_QUANTITY_TYPES.distance.identifier,
  workout: HEALTHKIT_WORKOUT_TYPE,
  sleep_segment: HEALTHKIT_SLEEP_TYPE,
};
