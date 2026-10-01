import { Platform } from "react-native";
import type { Permission } from "react-native-health-connect";

import { HEALTH_CONNECT_RECORD_TYPES, SYNCED_TYPES } from "./record-types";

/**
 * Read-only Health Connect access. openhealth does not write to Health
 * Connect (#25), so it asks for no write scopes. Background and history
 * access let sync run while the app is closed and backfill past 30 days.
 */
const READ_PERMISSIONS: Permission[] = SYNCED_TYPES.map((type) => ({
  accessType: "read",
  recordType: HEALTH_CONNECT_RECORD_TYPES[type],
}));

export type HealthAccess = {
  available: boolean;
  grantedTypes: string[];
  background: boolean;
  history: boolean;
};

export async function getHealthAccess(): Promise<HealthAccess> {
  const none = { available: false, grantedTypes: [], background: false, history: false };
  if (Platform.OS !== "android") return none;
  const hc = await import("react-native-health-connect");
  if ((await hc.getSdkStatus()) !== hc.SdkAvailabilityStatus.SDK_AVAILABLE) return none;
  await hc.initialize();
  const granted = (await hc.getGrantedPermissions()).filter((p) => p.accessType === "read");
  const names = new Set(granted.map((p) => p.recordType as string));
  return {
    available: true,
    grantedTypes: SYNCED_TYPES.filter((type) => names.has(HEALTH_CONNECT_RECORD_TYPES[type])),
    background: names.has("BackgroundAccessPermission"),
    history: names.has("ReadHealthDataHistory"),
  };
}

/** Shows the Health Connect permission sheet; returns the resulting access. */
export async function requestHealthAccess(): Promise<HealthAccess> {
  if (Platform.OS !== "android") throw new Error("HealthKit is not wired yet (#26).");
  const hc = await import("react-native-health-connect");
  await hc.initialize();
  await hc.requestPermission([
    ...READ_PERMISSIONS,
    { accessType: "read", recordType: "BackgroundAccessPermission" },
    { accessType: "read", recordType: "ReadHealthDataHistory" },
  ]);
  return getHealthAccess();
}
