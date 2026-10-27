import { Platform } from "react-native";
import type { Permission } from "react-native-health-connect";

import { HEALTHKIT_SYNCED_TYPES, healthKitAskedTypes } from "./healthkit-source";
import {
  healthConnectPermissionsForModules,
  healthKitReadTypesForModules,
  syncableRecordTypes,
  type ModuleProfile,
} from "./modules";
import { HEALTH_CONNECT_RECORD_TYPES, SYNCED_TYPES } from "./record-types";

/**
 * Read-only Health Connect access. OpenValens does not write to Health
 * Connect (#25), so it asks for no write scopes. Background and history
 * access let sync run while the app is closed and backfill past 30 days.
 * Only the data types of the person's enabled modules are asked for
 * (onboarding stage 1; not chosen = every module).
 */
function readPermissions(profile: ModuleProfile): Permission[] {
  return healthConnectPermissionsForModules(SYNCED_TYPES, profile);
}

export type HealthAccess = {
  platform: "health_connect" | "apple_health" | "none";
  available: boolean;
  /** Types that will sync. On iOS this means "asked", since HealthKit hides read grants. */
  grantedTypes: string[];
  background: boolean;
  history: boolean;
};

/** Types that can sync on this platform, for the modules that are on. */
export function syncableTypes(profile?: ModuleProfile): string[] {
  return Platform.OS === "ios"
    ? syncableRecordTypes(HEALTHKIT_SYNCED_TYPES, profile)
    : syncableRecordTypes(SYNCED_TYPES, profile);
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
  const grantedTypes = await healthKitAskedTypes();
  const asked = grantedTypes.length > 0;
  return {
    platform: "apple_health",
    available: true,
    grantedTypes,
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

/**
 * Shows the Apple Health / Health Connect permission sheet for the data types
 * of the enabled modules; returns the resulting access. With no health module
 * on there is nothing to ask for, so no sheet is shown.
 */
export async function requestHealthAccess(profile?: ModuleProfile): Promise<HealthAccess> {
  if (Platform.OS === "ios") {
    const hk = await import("@kingstinct/react-native-healthkit");
    const toRead = healthKitReadTypesForModules(HEALTHKIT_SYNCED_TYPES, profile);
    // Read-only: OpenValens never writes to Apple Health.
    if (toRead.length > 0) await hk.requestAuthorization({ toRead });
    return getHealthKitAccess();
  }
  const permissions = readPermissions(profile);
  if (permissions.length === 0) return getHealthAccess();
  const hc = await import("react-native-health-connect");
  await hc.initialize();
  await hc.requestPermission([
    ...permissions,
    { accessType: "read", recordType: "BackgroundAccessPermission" },
    { accessType: "read", recordType: "ReadHealthDataHistory" },
  ]);
  return getHealthAccess();
}
