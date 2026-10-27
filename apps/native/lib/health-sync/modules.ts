import {
  HEALTH_SYNC_KIND_MODULES,
  isHealthSyncKindEnabled,
  type HealthSyncKind,
  type PersonModule,
} from "@openvalens/api/presenters/modules";

import type { HealthSource } from "./drain";
import { HEALTHKIT_TYPE_IDENTIFIERS, type HealthKitReadIdentifier } from "./healthkit-types";
import type { MobileRecordType } from "./map-health-connect";
import type { HealthKitRecordType } from "./map-healthkit";
import { HEALTH_CONNECT_RECORD_TYPES, type HealthConnectRecordType } from "./record-types";

/**
 * Onboarding stage 1 — phone health sync follows the person's modules.
 *
 * Turning a module off stops reading its data types from Apple Health or
 * Health Connect (data already stored on the server is kept), and the
 * permission sheet only asks for the types of modules that are on. Pure, so
 * the onboarding flow can call it and `bun test` can check it.
 *
 * `profile` is the wellness profile (or anything with `enabledModules`);
 * `null`/`undefined` or `enabledModules: null` means not chosen = all on.
 */
export type ModuleProfile = { enabledModules: readonly PersonModule[] | null } | null | undefined;

/** Each contract record type and the module kind it belongs to. */
export const RECORD_TYPE_KINDS: Record<MobileRecordType, HealthSyncKind> = {
  steps: "steps",
  distance: "distance",
  active_calories: "active_energy",
  workout: "exercise",
  heart_rate: "heart_rate",
  sleep_session: "sleep",
  sleep_segment: "sleep",
  weight: "weight",
  body_fat: "body_fat",
};

export function recordTypeModule(type: MobileRecordType): PersonModule {
  return HEALTH_SYNC_KIND_MODULES[RECORD_TYPE_KINDS[type]];
}

export function isRecordTypeEnabled(profile: ModuleProfile, type: MobileRecordType): boolean {
  return isHealthSyncKindEnabled(profile, RECORD_TYPE_KINDS[type]);
}

/** The record types (of `types`) whose module is on, in the same order. */
export function syncableRecordTypes<T extends MobileRecordType>(
  types: readonly T[],
  profile: ModuleProfile,
): T[] {
  return types.filter((type) => isRecordTypeEnabled(profile, type));
}

/** Health Connect read permissions for the modules that are on. */
export function healthConnectPermissionsForModules(
  types: readonly HealthConnectRecordType[],
  profile: ModuleProfile,
): {
  accessType: "read";
  recordType: (typeof HEALTH_CONNECT_RECORD_TYPES)[HealthConnectRecordType];
}[] {
  return syncableRecordTypes(types, profile).map((type) => ({
    accessType: "read",
    recordType: HEALTH_CONNECT_RECORD_TYPES[type],
  }));
}

/** HealthKit read identifiers for the modules that are on. */
export function healthKitReadTypesForModules(
  types: readonly HealthKitRecordType[],
  profile: ModuleProfile,
): HealthKitReadIdentifier[] {
  return [
    ...new Set(syncableRecordTypes(types, profile).map((type) => HEALTHKIT_TYPE_IDENTIFIERS[type])),
  ];
}

/** A source that never reads the record types of hidden modules. */
export function sourceForModules(source: HealthSource, profile: ModuleProfile): HealthSource {
  return {
    ...source,
    async grantedTypes() {
      return syncableRecordTypes(await source.grantedTypes(), profile);
    },
  };
}
