/**
 * Health data permission flows for the mobile ingestion layer.
 *
 * Android — Health Connect via `react-native-health-connect`.
 * iOS     — HealthKit, NOT WIRED YET (`@kingstinct/react-native-healthkit`
 *           is deferred in package.json; see `requestHealthKitPermissions`).
 */
import { Platform } from "react-native";
import type { Permission, RecordType } from "react-native-health-connect";

/**
 * Read scopes required by the sync runner. Mirrors the OLD Kotlin companion
 * (`HealthConnectManager.requiredCorePermissions`) plus body fat / active
 * calories / distance for the extended ingestion buckets.
 */
export const READ_PERMISSIONS = [
  "Steps",
  "HeartRate",
  "SleepSession",
  "Weight",
  "BodyFat",
  "ActiveCaloriesBurned",
  "Distance",
  "ExerciseSession",
] as const;

export type HealthReadScope = (typeof READ_PERMISSIONS)[number];

/**
 * Write scopes for manually logged data (weight + workouts). The companion
 * only read; the RN app lets the user log these locally.
 */
export const WRITE_PERMISSIONS = ["Weight", "ExerciseSession"] as const;

export type HealthWriteScope = (typeof WRITE_PERMISSIONS)[number];

export type HealthScope = HealthReadScope | HealthWriteScope;

export interface HealthPermissionResult {
  granted: string[];
  denied: string[];
}

/** Stable `"<accessType>:<RecordType>"` key used for the granted/denied lists. */
export function permissionKey(accessType: "read" | "write", recordType: HealthScope): string {
  return `${accessType}:${recordType}`;
}

function toHealthConnectPermission(
  accessType: "read" | "write",
  recordType: HealthScope,
): Permission {
  return { accessType, recordType: recordType as RecordType };
}

/**
 * Request the full Health Connect permission set (read + write).
 *
 * Android only. Returns the requested scopes split into `granted`/`denied`,
 * each formatted as `"<accessType>:<RecordType>"` so callers can persist or
 * display them without importing Health Connect types.
 */
export async function requestHealthConnectPermissions(): Promise<HealthPermissionResult> {
  if (Platform.OS !== "android") {
    throw new Error(
      "requestHealthConnectPermissions is Android-only. Call requestHealthKitPermissions on iOS.",
    );
  }

  // Dynamic import keeps the native Health Connect module out of the iOS
  // bundle evaluation path.
  const healthConnect = await import("react-native-health-connect");

  const sdkStatus = await healthConnect.getSdkStatus();
  if (sdkStatus !== healthConnect.SdkAvailabilityStatus.SDK_AVAILABLE) {
    throw new Error(
      `Health Connect is unavailable on this device (sdkStatus=${sdkStatus}). Install or update the Health Connect app.`,
    );
  }

  await healthConnect.initialize();

  const requested: Permission[] = [
    ...READ_PERMISSIONS.map((scope) => toHealthConnectPermission("read", scope)),
    ...WRITE_PERMISSIONS.map((scope) => toHealthConnectPermission("write", scope)),
  ];

  const grantedPermissions = await healthConnect.requestPermission(requested);
  const grantedKeys = new Set(
    grantedPermissions.map((permission) => `${permission.accessType}:${permission.recordType}`),
  );

  const granted: string[] = [];
  const denied: string[] = [];
  for (const scope of READ_PERMISSIONS) {
    const key = permissionKey("read", scope);
    (grantedKeys.has(key) ? granted : denied).push(key);
  }
  for (const scope of WRITE_PERMISSIONS) {
    const key = permissionKey("write", scope);
    (grantedKeys.has(key) ? granted : denied).push(key);
  }

  return { granted, denied };
}

/**
 * Request HealthKit permissions.
 *
 * TODO: HealthKit not yet wired. `@kingstinct/react-native-healthkit` is
 * deferred in package.json because it requires the `react-native-nitro-modules`
 * native peer. Once added, mirror `requestHealthConnectPermissions` using
 * `HealthKit.requestAuthorization`.
 */
export async function requestHealthKitPermissions(): Promise<HealthPermissionResult> {
  throw new Error(
    "TODO: HealthKit not yet wired. Add @kingstinct/react-native-healthkit (and react-native-nitro-modules) then implement requestHealthKitPermissions.",
  );
}

/**
 * Platform-routing entry point used by onboarding UI.
 *
 * Android → Health Connect, iOS → HealthKit (stub).
 */
export function requestHealthPermissions(): Promise<HealthPermissionResult> {
  if (Platform.OS === "ios") {
    return requestHealthKitPermissions();
  }
  return requestHealthConnectPermissions();
}
