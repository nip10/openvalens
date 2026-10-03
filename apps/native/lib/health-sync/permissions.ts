import { Platform } from "react-native";
import type { Permission } from "react-native-health-connect";

import { HEALTHKIT_READ_TYPES, HEALTHKIT_SYNCED_TYPES } from "./healthkit-source";
import { HEALTH_CONNECT_RECORD_TYPES, SYNCED_TYPES } from "./record-types";

/**
 * Read-only Health Connect access. OpenValens does not write to Health
 * Connect (#25), so it asks for no write scopes. Background and history
 * access let sync run while the app is closed and backfill past 30 days.
 */
const READ_PERMISSIONS: Permission[] = SYNCED_TYPES.map((type) => ({
  accessType: "read",
  recordType: HEALTH_CONNECT_RECORD_TYPES[type],
}));

export type HealthAccess = {
  platform: "health_connect" | "apple_health" | "none";
  available: boolean;
  /** Types that will sync. On iOS this means "asked", since HealthKit hides read grants. */
  grantedTypes: string[];
  background: boolean;
  history: boolean;
};

/** Types that can sync on this platform (sleep is Android-only for now). */
export function syncableTypes(): string[] {
  return Platform.OS === "ios" ? HEALTHKIT_SYNCED_TYPES : SYNCED_TYPES;
}

async function getHealthKitAccess(): Promise<HealthAccess> {
  const hk = await import("@kingstinct/react-native-healthkit");
  if (!hk.isHealthDataAvailable())
    return {
      platform: "apple_health",
      available: false,
      grantedTypes: [],
      background: false,
      history: false,
    };
  const status = await hk.getRequestStatusForAuthorization({ toRead: HEALTHKIT_READ_TYPES });
  const asked = status === hk.AuthorizationRequestStatus.unnecessary;
  return {
    platform: "apple_health",
    available: true,
    grantedTypes: asked ? HEALTHKIT_SYNCED_TYPES : [],
    background: asked,
    history: asked,
  };
}

export async function getHealthAccess(): Promise<HealthAccess> {
  const none = {
    platform: "none" as const,
    available: false,
    grantedTypes: [],
    background: false,
    history: false,
  };
  if (Platform.OS === "ios") return getHealthKitAccess();
  if (Platform.OS !== "android") return none;
  const hc = await import("react-native-health-connect");
  if ((await hc.getSdkStatus()) !== hc.SdkAvailabilityStatus.SDK_AVAILABLE)
    return { ...none, platform: "health_connect" };
  await hc.initialize();
  const granted = (await hc.getGrantedPermissions()).filter((p) => p.accessType === "read");
  const names = new Set(granted.map((p) => p.recordType as string));
  return {
    platform: "health_connect",
    available: true,
    grantedTypes: SYNCED_TYPES.filter((type) => names.has(HEALTH_CONNECT_RECORD_TYPES[type])),
    background: names.has("BackgroundAccessPermission"),
    history: names.has("ReadHealthDataHistory"),
  };
}

/** Shows the Health Connect permission sheet; returns the resulting access. */
export async function requestHealthAccess(): Promise<HealthAccess> {
  if (Platform.OS === "ios") {
    const hk = await import("@kingstinct/react-native-healthkit");
    // Read-only: OpenValens never writes to Apple Health.
    await hk.requestAuthorization({ toRead: HEALTHKIT_READ_TYPES });
    return getHealthKitAccess();
  }
  const hc = await import("react-native-health-connect");
  await hc.initialize();
  await hc.requestPermission([
    ...READ_PERMISSIONS,
    { accessType: "read", recordType: "BackgroundAccessPermission" },
    { accessType: "read", recordType: "ReadHealthDataHistory" },
  ]);
  return getHealthAccess();
}
