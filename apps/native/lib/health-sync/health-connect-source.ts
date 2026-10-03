import type { MobileHealthRecordInput } from "@openvalens/api/contracts/mobile-ingest";
import Constants from "expo-constants";
import type { RecordType } from "react-native-health-connect";

import type { ChangesPage, HealthSource } from "./drain";
import {
  mapHealthConnectRecord,
  type HealthConnectRecordLike,
  type MapOptions,
  type MobileRecordType,
} from "./map-health-connect";
import { HEALTH_CONNECT_RECORD_TYPES, SYNCED_TYPES } from "./record-types";

/**
 * Android `HealthSource` on `react-native-health-connect`. Imported
 * dynamically so the native module never loads on iOS.
 */
async function healthConnect() {
  const module = await import("react-native-health-connect");
  await module.initialize();
  return module;
}

let mapOptions: MapOptions | null = null;
async function getMapOptions(): Promise<MapOptions> {
  if (mapOptions) return mapOptions;
  const { ExerciseType } = await import("react-native-health-connect");
  const exerciseTypeNames: Record<number, string> = {};
  for (const [name, value] of Object.entries(ExerciseType))
    exerciseTypeNames[value as number] = name;
  mapOptions = {
    ownPackage: Constants.expoConfig?.android?.package ?? "com.openvalens.app",
    exerciseTypeNames,
  };
  return mapOptions;
}

function mapAll(type: MobileRecordType, records: unknown[], options: MapOptions) {
  const mapped: MobileHealthRecordInput[] = [];
  for (const record of records) {
    const result = mapHealthConnectRecord(type, record as HealthConnectRecordLike, options);
    if (result) mapped.push(result);
  }
  return mapped;
}

export const healthConnectSource: HealthSource = {
  async grantedTypes() {
    const hc = await healthConnect();
    const granted = new Set(
      (await hc.getGrantedPermissions())
        .filter((permission) => permission.accessType === "read")
        .map((permission) => permission.recordType as string),
    );
    return SYNCED_TYPES.filter((type) => granted.has(HEALTH_CONNECT_RECORD_TYPES[type]));
  },

  async captureToken(type) {
    const hc = await healthConnect();
    const result = await hc.getChanges({
      recordTypes: [HEALTH_CONNECT_RECORD_TYPES[type] as RecordType],
    });
    return result.nextChangesToken;
  },

  async readWindow(type, from, to) {
    const hc = await healthConnect();
    const options = await getMapOptions();
    const records: unknown[] = [];
    let pageToken: string | undefined;
    do {
      const page = await hc.readRecords(HEALTH_CONNECT_RECORD_TYPES[type] as RecordType, {
        timeRangeFilter: {
          operator: "between",
          startTime: from.toISOString(),
          endTime: to.toISOString(),
        },
        ascendingOrder: true,
        ...(pageToken ? { pageToken } : {}),
      });
      records.push(...page.records);
      pageToken = page.pageToken;
    } while (pageToken);
    return mapAll(type, records, options);
  },

  async getChanges(type, token): Promise<ChangesPage> {
    const hc = await healthConnect();
    const options = await getMapOptions();
    const result = await hc.getChanges({ changesToken: token });
    return {
      upserts: mapAll(
        type,
        result.upsertionChanges.map((change) => change.record),
        options,
      ),
      deletions: result.deletionChanges.map((change) => ({ externalRecordId: change.recordId })),
      nextToken: result.nextChangesToken,
      hasMore: result.hasMore,
      expired: result.changesTokenExpired,
    };
  },
};
